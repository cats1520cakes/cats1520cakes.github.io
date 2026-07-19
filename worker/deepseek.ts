import type { EvidenceSource, WorkerEnv } from "./types";

const encoder = new TextEncoder();
const UPSTREAM_TIMEOUT_MS = 50_000;

function event(name: string, payload: unknown): Uint8Array {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function safeProviderMessage(status: number): string {
  if (status === 401) return "The model provider rejected its server-side credential.";
  if (status === 402) return "The model provider account has insufficient balance.";
  if (status === 429) return "The model provider is rate-limiting requests. Please retry shortly.";
  if (status === 503) return "The model provider is temporarily overloaded.";
  return `The model provider returned HTTP ${status}.`;
}

export function sseErrorResponse(message: string, status: number, sources: EvidenceSource[] = [], meta: Record<string, unknown> = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(event("meta", meta));
      controller.enqueue(event("sources", sources.map(({ content: _content, ...source }) => source)));
      controller.enqueue(event("error", { message }));
      controller.close();
    },
  });
  return new Response(body, { status, headers: sseHeaders() });
}

export function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
    "X-Accel-Buffering": "no",
  };
}

export async function streamDeepSeek(args: {
  env: WorkerEnv;
  messages: Array<{ role: string; content: string }>;
  sources: EvidenceSource[];
  mode: string;
  warning?: string;
  userId: string;
  requestId: string;
}): Promise<Response> {
  const { env, messages, sources, mode, warning, userId, requestId } = args;
  if (!env.DEEPSEEK_API_KEY) {
    return sseErrorResponse("The research model is not configured on the server.", 503, sources, {
      mode, evidenceType: "retrieval_only", warning, requestId,
    });
  }

  const baseUrl = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  let endpoint: URL;
  try {
    endpoint = new URL(`${baseUrl}/chat/completions`);
  } catch {
    return sseErrorResponse("The server model endpoint is misconfigured.", 503, sources, { mode, requestId });
  }
  if (endpoint.protocol !== "https:") {
    return sseErrorResponse("The server model endpoint must use HTTPS.", 503, sources, { mode, requestId });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || "deepseek-v4-flash",
        messages,
        stream: true,
        max_tokens: 1_400,
        temperature: 0.2,
        thinking: { type: "disabled" },
        user_id: userId,
      }),
    });
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "The model request timed out."
      : "The model provider could not be reached.";
    return sseErrorResponse(message, 504, sources, { mode, requestId });
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(timer);
    return sseErrorResponse(safeProviderMessage(upstream.status), 502, sources, { mode, requestId });
  }

  const publicSources = sources.map(({ content: _content, ...source }) => source);
  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      output.enqueue(event("meta", {
        mode,
        evidenceType: mode === "challenge" ? "evidence_analysis" : "retrieval_augmented_answer",
        model: env.DEEPSEEK_MODEL || "deepseek-v4-flash",
        warning,
        requestId,
      }));
      output.enqueue(event("sources", publicSources));
      output.enqueue(event("status", { stage: "generating" }));

      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let emitted = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() || "";
          for (const frame of frames) {
            for (const line of frame.split(/\r?\n/)) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              try {
                const payload = JSON.parse(data) as {
                  choices?: Array<{ delta?: { content?: string; reasoning_content?: string }; finish_reason?: string }>;
                };
                const text = payload.choices?.[0]?.delta?.content;
                if (text) {
                  emitted = true;
                  output.enqueue(event("delta", { text }));
                }
              } catch {
                // Ignore provider keep-alives and malformed partial frames.
              }
            }
          }
        }
        output.enqueue(event("done", { complete: emitted }));
      } catch {
        output.enqueue(event("error", { message: "The model stream ended unexpectedly." }));
      } finally {
        clearTimeout(timer);
        reader.releaseLock();
        output.close();
      }
    },
    cancel() {
      clearTimeout(timer);
      controller.abort();
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}
