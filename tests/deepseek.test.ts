import { afterEach, describe, expect, it, vi } from "vitest";
import { streamDeepSeek } from "../worker/deepseek";

describe("DeepSeek streaming proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("streams answer tokens and suppresses provider reasoning fields", async () => {
    const providerStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"choices":[{"delta":{"reasoning_content":"private reasoning","content":"Supported answer [S1]"}}]}\n\n',
        ));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const upstream = vi.fn(async (_url: URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer server-test-token");
      return new Response(providerStream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await streamDeepSeek({
      env: {
        ASSETS: { fetch: async () => new Response() },
        DEEPSEEK_API_KEY: "server-test-token",
        DEEPSEEK_MODEL: "deepseek-v4-flash",
      },
      messages: [{ role: "user", content: "Question" }],
      sources: [],
      mode: "qa",
      userId: "web_test",
      requestId: "request-test",
    });
    const output = await response.text();

    expect(output).toContain("Supported answer [S1]");
    expect(output).not.toContain("private reasoning");
    expect(output).not.toContain("server-test-token");
  });
});
