import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { aiAccessReady } from "../worker/access";
import { issueTestSession, passLimiter, protectedEnv, requestHeaders, TEST_ORIGIN } from "./access-helpers";

describe("AI access gate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fails closed when Turnstile, signing, or durable rate-limit bindings are missing", () => {
    expect(aiAccessReady(protectedEnv())).toBe(true);
    expect(aiAccessReady(protectedEnv({ TURNSTILE_SECRET_KEY: undefined }))).toBe(false);
    expect(aiAccessReady(protectedEnv({ AI_SESSION_SECRET: undefined }))).toBe(false);
    expect(aiAccessReady(protectedEnv({ AGENT_RATE_LIMITER: undefined }))).toBe(false);
  });

  it("issues a short-lived session only after server-side Turnstile verification", async () => {
    const testEnv = protectedEnv();
    const token = await issueTestSession("agent", testEnv);
    expect(token.split(".")).toHaveLength(2);
    expect(token).not.toContain(testEnv.AI_SESSION_SECRET!);
    expect(token).not.toContain(testEnv.TURNSTILE_SECRET_KEY!);
  });

  it("rejects a forged allowed Origin without a verified session", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(new Request(`${TEST_ORIGIN}/api/agent`, {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({ question: "Use this endpoint as a proxy." }),
    }), protectedEnv());
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("binds a session to both its endpoint scope and client fingerprint", async () => {
    const testEnv = protectedEnv();
    const token = await issueTestSession("zombie", testEnv);
    const wrongScope = await worker.fetch(new Request(`${TEST_ORIGIN}/api/agent`, {
      method: "POST",
      headers: requestHeaders(token),
      body: JSON.stringify({ question: "Wrong scope." }),
    }), testEnv);
    expect(wrongScope.status).toBe(401);

    const wrongClientHeaders = requestHeaders(token);
    wrongClientHeaders["User-Agent"] = "different-client/1.0";
    const wrongClient = await worker.fetch(new Request(`${TEST_ORIGIN}/api/zombie-command`, {
      method: "POST",
      headers: wrongClientHeaders,
      body: JSON.stringify({ snapshot: { bots: [{ id: 0 }] } }),
    }), testEnv);
    expect(wrongClient.status).toBe(401);
  });

  it("enforces the Cloudflare rate-limit binding before any model call", async () => {
    const testEnv = protectedEnv();
    const token = await issueTestSession("agent", testEnv);
    testEnv.AGENT_RATE_LIMITER = { limit: async () => ({ success: false }) };
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(new Request(`${TEST_ORIGIN}/api/agent`, {
      method: "POST",
      headers: requestHeaders(token),
      body: JSON.stringify({ question: "Rate limited request." }),
    }), testEnv);
    expect(response.status).toBe(429);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects failed Turnstile verification without issuing a session", async () => {
    const testEnv = protectedEnv({ SESSION_RATE_LIMITER: passLimiter() });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: false,
      hostname: "example.com",
      action: "ai_session",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const response = await worker.fetch(new Request(`${TEST_ORIGIN}/api/ai-session`, {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({ scope: "agent", turnstileToken: "invalid-turnstile-token" }),
    }), testEnv);
    expect(response.status).toBe(403);
  });
});
