import { vi } from "vitest";
import worker from "../worker/index";
import type { AiScope, RateLimiterBinding, WorkerEnv } from "../worker/types";

export const TEST_ORIGIN = "https://example.com";
export const TEST_IP = "203.0.113.8";
export const TEST_USER_AGENT = "security-test-browser/1.0";

export function passLimiter(): RateLimiterBinding {
  return { limit: async () => ({ success: true }) };
}

export function protectedEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    ASSETS: { fetch: async () => new Response("asset") },
    DEEPSEEK_API_KEY: "server-side-test-key",
    DEEPSEEK_MODEL: "deepseek-v4-flash",
    TURNSTILE_SITE_KEY: "public-test-site-key",
    TURNSTILE_SECRET_KEY: "private-test-turnstile-secret",
    TURNSTILE_ALLOWED_HOSTNAMES: "example.com",
    AI_SESSION_SECRET: "test-session-secret-with-more-than-32-bytes",
    SESSION_RATE_LIMITER: passLimiter(),
    AGENT_RATE_LIMITER: passLimiter(),
    GAME_RATE_LIMITER: passLimiter(),
    ...overrides,
  };
}

export function requestHeaders(token?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Origin: TEST_ORIGIN,
    "User-Agent": TEST_USER_AGENT,
    "CF-Connecting-IP": TEST_IP,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function issueTestSession(scope: AiScope, env: WorkerEnv): Promise<string> {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    success: true,
    hostname: "example.com",
    action: "ai_session",
  }), { status: 200, headers: { "Content-Type": "application/json" } })));

  const response = await worker.fetch(new Request(`${TEST_ORIGIN}/api/ai-session`, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify({ scope, turnstileToken: "valid-turnstile-test-token" }),
  }), env);
  const payload = await response.json() as { token?: string; error?: string };
  vi.unstubAllGlobals();
  if (!response.ok || !payload.token) throw new Error(payload.error || "Failed to issue test AI session.");
  return payload.token;
}
