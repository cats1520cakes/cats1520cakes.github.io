import { RequestError } from "./security";
import type { AiScope, RateLimiterBinding, WorkerEnv } from "./types";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT_MS = 8_000;
const SESSION_TTL_SECONDS = 30 * 60;
const MAX_TURNSTILE_TOKEN_CHARS = 2_048;
const encoder = new TextEncoder();

interface SessionClaims {
  v: 1;
  scope: AiScope;
  iat: number;
  exp: number;
  jti: string;
  fp: string;
}

interface TurnstileResult {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new RequestError(401, "AI session is invalid.");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new RequestError(401, "AI session is invalid.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function requestFingerprint(request: Request): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userAgent = (request.headers.get("User-Agent") || "unknown").slice(0, 240);
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${ip}\n${userAgent}`));
  return encodeBase64Url(new Uint8Array(digest));
}

function allowedTurnstileHostnames(request: Request, env: WorkerEnv): string[] {
  const configured = (env.TURNSTILE_ALLOWED_HOSTNAMES || "")
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
  return configured.length ? configured : [new URL(request.url).hostname.toLowerCase()];
}

export function aiAccessReady(env: WorkerEnv): boolean {
  return Boolean(
    env.TURNSTILE_SITE_KEY &&
    env.TURNSTILE_SECRET_KEY &&
    env.AI_SESSION_SECRET &&
    env.SESSION_RATE_LIMITER &&
    env.AGENT_RATE_LIMITER &&
    env.GAME_RATE_LIMITER,
  );
}

async function enforceLimiter(limiter: RateLimiterBinding | undefined, keys: string[]): Promise<void> {
  if (!limiter) throw new RequestError(503, "AI access protection is not configured.");
  for (const key of keys) {
    const result = await limiter.limit({ key });
    if (!result.success) throw new RequestError(429, "AI request limit reached. Please retry later.");
  }
}

async function verifyTurnstile(request: Request, token: unknown, env: WorkerEnv): Promise<void> {
  if (!aiAccessReady(env)) throw new RequestError(503, "AI access protection is not configured.");
  if (typeof token !== "string" || token.length < 10 || token.length > MAX_TURNSTILE_TOKEN_CHARS) {
    throw new RequestError(403, "Human verification is required.");
  }

  const form = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY!,
    response: token,
    remoteip: request.headers.get("CF-Connecting-IP") || "",
    idempotency_key: crypto.randomUUID(),
  });

  let response: Response;
  try {
    response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
  } catch {
    throw new RequestError(503, "Human verification is temporarily unavailable.");
  }
  if (!response.ok) throw new RequestError(503, "Human verification is temporarily unavailable.");

  let result: TurnstileResult;
  try {
    result = await response.json() as TurnstileResult;
  } catch {
    throw new RequestError(503, "Human verification returned an invalid response.");
  }

  const hostname = (result.hostname || "").toLowerCase();
  if (!result.success || result.action !== "ai_session" || !allowedTurnstileHostnames(request, env).includes(hostname)) {
    throw new RequestError(403, "Human verification failed.");
  }
}

export async function issueAiSession(
  request: Request,
  scope: AiScope,
  turnstileToken: unknown,
  env: WorkerEnv,
): Promise<{ token: string; expiresIn: number }> {
  const fingerprint = await requestFingerprint(request);
  await enforceLimiter(env.SESSION_RATE_LIMITER, [`session:${fingerprint}`]);
  await verifyTurnstile(request, turnstileToken, env);

  const now = Math.floor(Date.now() / 1_000);
  const claims: SessionClaims = {
    v: 1,
    scope,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    jti: crypto.randomUUID(),
    fp: fingerprint,
  };
  const payload = encodeBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env.AI_SESSION_SECRET!), encoder.encode(payload));
  return { token: `${payload}.${encodeBase64Url(new Uint8Array(signature))}`, expiresIn: SESSION_TTL_SECONDS };
}

export async function authorizeAiRequest(request: Request, scope: AiScope, env: WorkerEnv): Promise<string> {
  if (!aiAccessReady(env)) throw new RequestError(503, "AI access protection is not configured.");
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new RequestError(401, "A verified AI session is required.");
  const token = authorization.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 2) throw new RequestError(401, "AI session is invalid.");

  const validSignature = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(env.AI_SESSION_SECRET!),
    decodeBase64Url(parts[1]).slice().buffer as ArrayBuffer,
    encoder.encode(parts[0]),
  );
  if (!validSignature) throw new RequestError(401, "AI session is invalid.");

  let claims: SessionClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]))) as SessionClaims;
  } catch {
    throw new RequestError(401, "AI session is invalid.");
  }

  const now = Math.floor(Date.now() / 1_000);
  if (
    claims.v !== 1 || claims.scope !== scope || !claims.jti || !claims.fp ||
    !Number.isFinite(claims.iat) || !Number.isFinite(claims.exp) ||
    claims.iat > now + 60 || claims.exp <= now || claims.exp - claims.iat > SESSION_TTL_SECONDS
  ) throw new RequestError(401, "AI session is invalid or expired.");

  if (claims.fp !== await requestFingerprint(request)) throw new RequestError(401, "AI session does not match this client.");

  const limiter = scope === "agent" ? env.AGENT_RATE_LIMITER : env.GAME_RATE_LIMITER;
  const fingerprint = claims.fp.slice(0, 24);
  await enforceLimiter(limiter, [`token:${claims.jti}`, `client:${fingerprint}`]);
  return claims.jti;
}
