import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { sanitizeOrders, sanitizeSnapshot } from "../worker/elite";
import type { WorkerEnv } from "../worker/types";
import { issueTestSession, protectedEnv, requestHeaders, TEST_ORIGIN } from "./access-helpers";

const SNAPSHOT = {
  wave: 5,
  playerX: 12.5,
  playerY: 1.2,
  playerZ: -8.5,
  playerHp: 72,
  playerHigh: false,
  zombiesNear: 4,
  elites: [
    { id: 0, x: 10, z: -5, hp: 300, dist: 14.2, canSpit: true, canCharge: true, canRoar: false, canSlam: true, canSummon: false },
    { id: 1, x: -20, z: 22, hp: 250, dist: 30, canSpit: false, canCharge: true, canRoar: true, canSlam: false, canSummon: true },
  ],
};

function env(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return protectedEnv(overrides);
}

function post(body: unknown, token?: string, origin = TEST_ORIGIN) {
  return new Request("https://example.com/api/elite-command", {
    method: "POST",
    headers: { ...requestHeaders(token), Origin: origin },
    body: JSON.stringify(body),
  });
}

describe("elite snapshot sanitizers", () => {
  it("clamps coordinates and booleans, drops out-of-range elite ids", () => {
    const snap = sanitizeSnapshot({
      wave: 999,
      playerX: 999,
      playerY: 99,
      playerZ: -999,
      playerHp: 250,
      playerHigh: "yes",
      zombiesNear: 999,
      elites: [
        { id: 0, x: 1e9, z: -1e9, hp: 9999, dist: 999, canSpit: "yes", canCharge: 1, canRoar: true, canSlam: false, canSummon: true },
        { id: 7, x: 0, z: 0, hp: 100, dist: -5, canSpit: true },
        { id: -1, x: 0, z: 0, hp: 100, dist: 10 },
      ],
    });
    expect(snap.wave).toBe(99);
    expect(snap.playerX).toBe(40);
    expect(snap.playerY).toBe(12);
    expect(snap.playerZ).toBe(-40);
    expect(snap.playerHp).toBe(100);
    expect(snap.playerHigh).toBe(false);
    expect(snap.zombiesNear).toBe(40);
    expect(snap.elites).toHaveLength(1); // id 7 / -1 越界直接丢弃
    expect(snap.elites[0]).toMatchObject({ id: 0, x: 40, z: -40, hp: 1000, dist: 80, canSpit: false, canCharge: false, canRoar: true, canSummon: true });
  });

  it("keeps at most 3 elites", () => {
    const snap = sanitizeSnapshot({
      elites: [0, 1, 2, 0].map((id) => ({ id, x: 0, z: 0, hp: 100, dist: 10 })),
    });
    expect(snap.elites).toHaveLength(3);
  });

  it("drops orders with unknown ids or illegal actions and clamps the rest", () => {
    const orders = sanitizeOrders(
      {
        orders: [
          { id: 0, action: "spit", tx: 999, tz: -999, say: "  撕碎你！！！！！！  " },
          { id: 2, action: "charge", tx: 0, tz: 0 }, // 快照里没有 id 2
          { id: 1, action: "stalk", tx: 3.5, tz: -8.2 },
        ],
      },
      new Set([0, 1]),
    );
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({ id: 0, action: "spit", tx: 40, tz: -40 });
    expect(orders[0].say).toHaveLength(8);
    expect(orders[1]).toMatchObject({ id: 1, action: "stalk", tx: 3.5, tz: -8.2 });
  });

  it("drops illegal actions", () => {
    const orders = sanitizeOrders(
      {
        orders: [
          { id: 1, action: "fly", tx: 0, tz: 0 }, // 非法 action
          { id: 0, action: "spit", tx: 0, tz: 0 },
          { id: 1, action: "charge", tx: 0, tz: 0 },
        ],
      },
      new Set([0, 1]),
    );
    expect(orders.map((order) => order.action)).toEqual(["spit", "charge"]);
  });

  it("keeps at most 3 orders", () => {
    const orders = sanitizeOrders(
      {
        orders: [
          { id: 0, action: "spit", tx: 0, tz: 0 },
          { id: 1, action: "charge", tx: 0, tz: 0 },
          { id: 0, action: "slam", tx: 1, tz: 1 },
          { id: 1, action: "roar", tx: 2, tz: 2 },
        ],
      },
      new Set([0, 1]),
    );
    expect(orders).toHaveLength(3);
    expect(orders.map((order) => order.action)).toEqual(["spit", "charge", "slam"]);
  });
});

describe("/api/elite-command route", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects originless requests", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/elite-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: SNAPSHOT }),
      }),
      env(),
    );
    expect(response.status).toBe(403);
  });

  it("returns empty orders without calling upstream when elites is empty", async () => {
    const testEnv = env();
    const token = await issueTestSession("elite", testEnv);
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(post({ snapshot: { ...SNAPSHOT, elites: [] } }, token), testEnv);
    expect(response.status).toBe(200);
    const payload = await response.json() as { orders: unknown[] };
    expect(payload.orders).toEqual([]);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("proxies to DeepSeek server-side and never leaks the key", async () => {
    const testEnv = env();
    const token = await issueTestSession("elite", testEnv);
    const upstream = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer server-side-test-key");
      const payload = JSON.parse(String(init?.body)) as {
        stream: boolean;
        temperature: number;
        max_tokens: number;
        response_format: { type: string };
        messages: unknown[];
      };
      expect(payload.stream).toBe(false);
      expect(payload.temperature).toBe(0.7);
      expect(payload.max_tokens).toBe(300);
      expect(payload.response_format.type).toBe("json_object");
      expect(payload.messages).toHaveLength(2);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ orders: [{ id: 0, action: "spit", tx: 3.5, tz: -8.2, say: "撕碎你" }] }) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await worker.fetch(post({ snapshot: SNAPSHOT }, token), testEnv);
    expect(response.status).toBe(200);
    const payload = await response.json() as { orders: Array<Record<string, unknown>> };
    expect(payload.orders).toHaveLength(1);
    expect(payload.orders[0]).toMatchObject({ id: 0, action: "spit", tx: 3.5, tz: -8.2, say: "撕碎你" });
    expect(JSON.stringify(payload)).not.toContain("server-side-test-key");
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("maps upstream 429 to 502 without provider details", async () => {
    const testEnv = env();
    const token = await issueTestSession("elite", testEnv);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("too many requests", { status: 429 })));
    const response = await worker.fetch(post({ snapshot: SNAPSHOT }, token), testEnv);
    expect(response.status).toBe(502);
    const payload = await response.json() as Record<string, unknown>;
    expect(String(payload.error)).toContain("rate-limiting");
    expect(JSON.stringify(payload)).not.toContain("server-side-test-key");
  });

  it("maps upstream timeouts to 504", async () => {
    const testEnv = env();
    const token = await issueTestSession("elite", testEnv);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }));
    const response = await worker.fetch(post({ snapshot: SNAPSHOT }, token), testEnv);
    expect(response.status).toBe(504);
    const payload = await response.json() as Record<string, unknown>;
    expect(String(payload.error)).toContain("timed out");
  });

  it("returns 503 when the server key is not configured", async () => {
    const testEnv = env({ DEEPSEEK_API_KEY: undefined });
    const token = await issueTestSession("elite", testEnv);
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
