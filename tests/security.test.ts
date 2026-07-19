import { describe, expect, it } from "vitest";
import { corsHeaders, parseAgentRequest, readJsonBody, RequestError, validateOrigin, validatePublicUrl } from "../worker/security";

describe("request security", () => {
  it("accepts a public HTTPS page", () => {
    expect(validatePublicUrl("https://www.ijcai.org/proceedings/2025/593").hostname).toBe("www.ijcai.org");
  });

  it.each([
    "http://example.com",
    "https://localhost/private",
    "https://127.0.0.1/private",
    "https://169.254.169.254/latest/meta-data",
    "https://10.1.2.3/internal",
  ])("rejects unsafe context URL %s", (value) => {
    expect(() => validatePublicUrl(value)).toThrow(RequestError);
  });

  it("requires same-origin browser calls", () => {
    const request = new Request("https://example.com/api/agent", { headers: { Origin: "https://example.com" } });
    expect(validateOrigin(request, {} as never)).toBe(true);
    const crossOrigin = new Request("https://example.com/api/agent", { headers: { Origin: "https://attacker.example" } });
    expect(validateOrigin(crossOrigin, {} as never)).toBe(false);
  });

  it("bounds and normalizes the request payload", async () => {
    const request = new Request("https://example.com/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "challenge", question: "  Challenge this claim.  ", history: [] }),
    });
    const parsed = await parseAgentRequest(request);
    expect(parsed.mode).toBe("challenge");
    expect(parsed.question).toBe("Challenge this claim.");
  });

  it("bounds a streamed body even when Content-Length is absent", async () => {
    const request = new Request("https://example.com/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(200) }),
    });
    await expect(readJsonBody(request, 32)).rejects.toMatchObject({ status: 413 });
  });

  it("allows only the headers needed by signed browser sessions", () => {
    const headers = new Headers(corsHeaders(new Request("https://example.com", { headers: { Origin: "https://example.com" } })));
    expect(headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization");
  });
});
