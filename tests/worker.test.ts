import { describe, expect, it } from "vitest";
import worker from "../worker/index";

describe("worker routes", () => {
  it("returns health without exposing credentials", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/health"), {
      ASSETS: { fetch: async () => new Response("asset") },
      DEEPSEEK_MODEL: "deepseek-v4-flash",
    });
    const payload = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.aiEnabled).toBe(false);
    expect(payload.turnstileSiteKey).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("DEEPSEEK_API_KEY");
  });

  it("rejects originless agent requests", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "hello" }),
    }), {
      ASSETS: { fetch: async () => new Response("asset") },
    });
    expect(response.status).toBe(403);
  });
});
