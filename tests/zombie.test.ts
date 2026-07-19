import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { sanitizeOrders, sanitizeSnapshot } from "../worker/zombie";
import type { WorkerEnv } from "../worker/types";
import { issueTestSession, protectedEnv, requestHeaders, TEST_ORIGIN } from "./access-helpers";

const SNAPSHOT = {
  wave: 3,
  hp: 80,
  weapon: "gatling",
  px: 480,
  py: 300,
  bots: [
    { id: 0, x: 400, y: 280, infected: false },
    { id: 1, x: 560, y: 280, infected: false },
    { id: 2, x: 480, y: 380, infected: true },
  ],
  zombies: [{ id: 7, t: "b", x: 300, y: 200 }],
  crates: [{ k: "weapon", x: 500, y: 320 }],
};

function env(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return protectedEnv(overrides);
}

function post(body: unknown, token?: string, origin = TEST_ORIGIN) {
  return new Request("https://example.com/api/zombie-command", {
    method: "POST",
    headers: { ...requestHeaders(token), Origin: origin },
    body: JSON.stringify(body),
  });
}

describe("zombie snapshot sanitizers", () => {
  it("clamps coordinates and filters unknown enum values", () => {
    const snap = sanitizeSnapshot({
      wave: 999,
      hp: 250,
      weapon: "rocket-launcher",
      px: -50,
      py: 9999,
      bots: [{ id: 0, x: 1e9, y: -1e9, infected: "yes" }],
      zombies: [{ id: 1, t: "dragon", x: 10, y: 10 }],
      crates: [{ k: "nuke", x: 10, y: 10 }],
    });
    expect(snap.wave).toBe(99);
    expect(snap.hp).toBe(100);
    expect(snap.weapon).toBe("rifle");
    expect(snap.px).toBe(0);
    expect(snap.py).toBe(540);
    expect(snap.bots[0].infected).toBe(false);
    expect(snap.zombies[0].t).toBe("w");
    expect(snap.crates[0].k).toBe("ammo");
  });

  it("rejects a snapshot without bots", () => {
    expect(() => sanitizeSnapshot({ bots: [] })).toThrowError(/bots/);
  });

  it("drops invalid orders and clamps the rest", () => {
    const orders = sanitizeOrders({
      orders: [
        { id: 1, mx: 99999, my: -50, focus: "brute", say: "  干掉它们！！  " },
        { id: 9, mx: 10, my: 10, focus: "nearest" },
        { id: 2, mx: 100, my: 100, focus: "fly", say: "x".repeat(60) },
      ],
    });
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({ id: 1, mx: 922, my: 38, focus: "brute", say: "干掉它们！！" });
    expect(orders[1].focus).toBe("nearest");
    expect(orders[1].say).toHaveLength(14);
  });
});

describe("/api/zombie-command route", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects originless requests", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/zombie-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: SNAPSHOT }),
      }),
      env(),
    );
    expect(response.status).toBe(403);
  });

  it("proxies to DeepSeek server-side and never leaks the key", async () => {
    const testEnv = env();
    const token = await issueTestSession("zombie", testEnv);
    const upstream = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer server-side-test-key");
      const payload = JSON.parse(String(init?.body)) as { stream: boolean; messages: unknown[] };
      expect(payload.stream).toBe(false);
      expect(payload.messages).toHaveLength(2);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ orders: [{ id: 0, mx: 300, my: 200, focus: "nearest", say: "守住" }] }) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await worker.fetch(post({ snapshot: SNAPSHOT }, token), testEnv);
    expect(response.status).toBe(200);
    const payload = await response.json() as { orders: unknown[] };
    expect(payload.orders).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain("server-side-test-key");
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("maps upstream failures to 502 without provider details", async () => {
    const testEnv = env();
    const token = await issueTestSession("zombie", testEnv);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    const response = await worker.fetch(post({ snapshot: SNAPSHOT }, token), testEnv);
    expect(response.status).toBe(502);
    const payload = await response.json() as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain("server-side-test-key");
  });

  it("returns 503 when the server key is not configured", async () => {
    const testEnv = env({ DEEPSEEK_API_KEY: undefined });
    const token = await issueTestSession("zombie", testEnv);
    const response = await worker.fetch(post({ snapshot: SNAPSHOT }, token), testEnv);
    expect(response.status).toBe(503);
  });

  it("rejects a forged allowed Origin when no verified session is present", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(post({ snapshot: SNAPSHOT }), env());
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
});
