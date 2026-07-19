import type { AgentHistoryItem, AgentMode, AgentRequestBody, WorkerEnv } from "./types";

const MAX_QUESTION_CHARS = 8_000;
const MAX_URL_CHARS = 2_048;
const MAX_HISTORY_ITEMS = 8;
const MAX_HISTORY_ITEM_CHARS = 2_000;
const MAX_BODY_BYTES = 64_000;

export class RequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

export function validateOrigin(request: Request, env: WorkerEnv): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }

  const requestOrigin = new URL(request.url).origin;
  if (normalizedOrigin === requestOrigin) return true;

  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(normalizedOrigin);
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin") || "null";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > maxBytes) throw new RequestError(413, "Request body is too large.");
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
    throw new RequestError(415, "Content-Type must be application/json.");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "Request body must be valid JSON.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestError(413, "Request body is too large.");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged)) as unknown;
  } catch {
    throw new RequestError(400, "Request body must be valid JSON.");
  }
}

export async function parseAgentRequest(request: Request): Promise<AgentRequestBody> {
  const raw = await readJsonBody(request, MAX_BODY_BYTES);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RequestError(400, "Request body must be a JSON object.");
  }

  const input = raw as Record<string, unknown>;
  const allowedModes: AgentMode[] = ["qa", "challenge", "fit"];
  const mode = allowedModes.includes(input.mode as AgentMode) ? input.mode as AgentMode : "qa";
  const question = cleanText(input.question, MAX_QUESTION_CHARS);
  if (question.length < 3) throw new RequestError(400, "Question must contain at least three characters.");

  const contextUrl = cleanText(input.contextUrl, MAX_URL_CHARS);
  const history: AgentHistoryItem[] = Array.isArray(input.history)
    ? input.history.slice(-MAX_HISTORY_ITEMS).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      const role = entry.role === "assistant" ? "assistant" : entry.role === "user" ? "user" : null;
      const content = cleanText(entry.content, MAX_HISTORY_ITEM_CHARS);
      return role && content ? [{ role, content }] : [];
    })
    : [];

  if (contextUrl) validatePublicUrl(contextUrl);
  return {
    mode,
    question,
    contextUrl: contextUrl || undefined,
    useSearch: input.useSearch === true,
    history,
  };
}

export function validatePublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RequestError(400, "The context URL is invalid.");
  }

  if (url.protocol !== "https:") throw new RequestError(400, "Only HTTPS context URLs are accepted.");
  if (url.username || url.password) throw new RequestError(400, "Context URLs cannot contain credentials.");
  if (url.port && url.port !== "443") throw new RequestError(400, "Non-standard URL ports are not accepted.");

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blockedNames = ["localhost", "localhost.localdomain", "metadata.google.internal"];
  if (blockedNames.includes(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new RequestError(400, "Private or local context URLs are not accepted.");
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((part) => part > 255)) throw new RequestError(400, "The context URL is invalid.");
    const [a, b] = octets;
    if (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) throw new RequestError(400, "Private or local context URLs are not accepted.");
  }

  // Literal IPv6 hosts are rejected. Public sites should use their DNS name; this also
  // closes IPv4-mapped and alternate-notation private-address bypasses.
  if (host.includes(":")) throw new RequestError(400, "Literal IPv6 context URLs are not accepted.");
  return url;
}

export async function anonymousUserId(request: Request): Promise<string> {
  const source = request.headers.get("CF-Connecting-IP") || "anonymous";
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `web_${[...new Uint8Array(digest)].slice(0, 12).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
