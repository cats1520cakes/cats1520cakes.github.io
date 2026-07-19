import { streamDeepSeek } from "./deepseek";
import { aiAccessReady, authorizeAiRequest, issueAiSession } from "./access";
import { fetchPublicContext, searchExternal } from "./external";
import { buildDeepSeekMessages } from "./prompts";
import { knowledgeStats, retrieveEvidence } from "./retrieval";
import { handleEliteCommand } from "./elite";
import { handleZombieCommand } from "./zombie";
import {
  anonymousUserId,
  corsHeaders,
  parseAgentRequest,
  readJsonBody,
  RequestError,
  validateOrigin,
} from "./security";
import type { AiScope, EvidenceSource, WorkerEnv } from "./types";

function json(payload: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

async function handleAgent(request: Request, env: WorkerEnv): Promise<Response> {
  if (!validateOrigin(request, env)) return json({ error: "Origin is not allowed." }, 403);
  await authorizeAiRequest(request, "agent", env);

  const input = await parseAgentRequest(request);
  const sources: EvidenceSource[] = retrieveEvidence(`${input.question} ${input.mode}`, 7);
  let warning: string | undefined;

  if (input.contextUrl) {
    const external = await fetchPublicContext(input.contextUrl);
    external.id = `U${sources.filter((source) => source.trust === "untrusted_external").length + 1}`;
    sources.push(external);
  }

  if (input.useSearch) {
    const externalCount = sources.filter((source) => source.trust === "untrusted_external").length;
    const search = await searchExternal(input.question, env, externalCount + 1);
    sources.push(...search.sources);
    warning = search.warning;
  }

  const requestId = crypto.randomUUID();
  const userId = await anonymousUserId(request);
  const messages = buildDeepSeekMessages(input, sources);
  return streamDeepSeek({ env, messages, sources, mode: input.mode, warning, userId, requestId });
}

function withCors(response: Response, request: Request, env: WorkerEnv): Response {
  if (!validateOrigin(request, env)) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, String(value));
  return new Response(response.body, { status: response.status, headers });
}

async function handleSession(request: Request, env: WorkerEnv): Promise<Response> {
  if (!validateOrigin(request, env)) throw new RequestError(403, "Origin is not allowed.");
  const raw = await readJsonBody(request, 4_096);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestError(400, "Request body must be a JSON object.");
  const input = raw as Record<string, unknown>;
  const scopes: AiScope[] = ["agent", "zombie", "elite"];
  if (!scopes.includes(input.scope as AiScope)) throw new RequestError(400, "AI session scope is invalid.");
  return json(await issueAiSession(request, input.scope as AiScope, input.turnstileToken, env));
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        aiEnabled: aiAccessReady(env) && Boolean(env.DEEPSEEK_API_KEY),
        turnstileSiteKey: aiAccessReady(env) ? env.TURNSTILE_SITE_KEY : undefined,
        knowledgeChunks: knowledgeStats().chunks,
      });
    }

    if (["/api/ai-session", "/api/agent", "/api/zombie-command", "/api/elite-command"].includes(url.pathname) && request.method === "OPTIONS") {
      if (!validateOrigin(request, env)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === "/api/ai-session" && request.method === "POST") {
      try {
        return withCors(await handleSession(request, env), request, env);
      } catch (error) {
        const status = error instanceof RequestError ? error.status : 500;
        const message = error instanceof RequestError ? error.message : "The AI access service encountered an unexpected error.";
        return withCors(json({ error: message }, status), request, env);
      }
    }

    if (url.pathname === "/api/agent" && request.method === "POST") {
      try {
        return withCors(await handleAgent(request, env), request, env);
      } catch (error) {
        const status = error instanceof RequestError ? error.status : 500;
        const message = error instanceof RequestError ? error.message : "The research service encountered an unexpected error.";
        return withCors(json({ error: message }, status), request, env);
      }
    }

    if (url.pathname === "/api/zombie-command" && request.method === "POST") {
      try {
        return withCors(await handleZombieCommand(request, env), request, env);
      } catch (error) {
        const status = error instanceof RequestError ? error.status : 500;
        const message = error instanceof RequestError ? error.message : "The commander service encountered an unexpected error.";
        return withCors(json({ error: message }, status), request, env);
      }
    }

    if (url.pathname === "/api/elite-command" && request.method === "POST") {
      try {
        return withCors(await handleEliteCommand(request, env), request, env);
      } catch (error) {
        const status = error instanceof RequestError ? error.status : 500;
        const message = error instanceof RequestError ? error.message : "The commander service encountered an unexpected error.";
        return withCors(json({ error: message }, status), request, env);
      }
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "API route not found." }, 404);
    return env.ASSETS.fetch(request);
  },
};

export { handleAgent };
