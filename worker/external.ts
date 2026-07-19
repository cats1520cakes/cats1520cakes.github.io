import { RequestError, validatePublicUrl } from "./security";
import type { EvidenceSource, WorkerEnv } from "./types";

const MAX_EXTERNAL_BYTES = 320_000;
const MAX_EXTERNAL_CHARS = 10_000;
const FETCH_TIMEOUT_MS = 9_000;

function decodeEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  };
  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return entities[entity.toLowerCase()] ?? match;
  });
}

function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "External page")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  const text = decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXTERNAL_CHARS);
  return { title, text };
}

async function readLimitedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_EXTERNAL_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = MAX_EXTERNAL_BYTES - total;
    const part = value.length > remaining ? value.slice(0, remaining) : value;
    chunks.push(part);
    total += part.length;
    if (part.length < value.length) break;
  }
  await reader.cancel().catch(() => undefined);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

export async function fetchPublicContext(value: string): Promise<EvidenceSource> {
  let url = validatePublicUrl(value);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          Accept: "text/html,text/plain;q=0.9",
          "User-Agent": "HaoqiResearchAgent/1.0 (+https://cats1520cakes.github.io)",
        },
      });
    } catch {
      throw new RequestError(422, "The public context URL could not be fetched.");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location || redirect === 3) throw new RequestError(422, "The context URL redirected too many times.");
      url = validatePublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new RequestError(422, `The context URL returned HTTP ${response.status}.`);

    const length = Number(response.headers.get("Content-Length") || "0");
    if (length > MAX_EXTERNAL_BYTES) throw new RequestError(413, "The context page is too large.");
    const contentType = response.headers.get("Content-Type")?.toLowerCase() || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new RequestError(415, "The context URL must return HTML or plain text. Use a paper landing page rather than a PDF URL.");
    }

    const raw = await readLimitedBody(response);
    const parsed = contentType.includes("text/html") ? htmlToText(raw) : { title: url.hostname, text: raw.slice(0, MAX_EXTERNAL_CHARS) };
    if (parsed.text.length < 40) throw new RequestError(422, "The context page did not expose enough readable text.");
    return {
      id: "U1",
      title: parsed.title || url.hostname,
      content: parsed.text,
      evidenceType: "external_page",
      status: "runtime_untrusted",
      sourceUrl: url.toString(),
      trust: "untrusted_external",
    };
  }
  throw new RequestError(422, "The context URL could not be fetched.");
}

type SearchResult = { title: string; url: string; snippet: string };

async function braveSearch(query: string, apiKey: string): Promise<SearchResult[]> {
  const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", "5");
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new RequestError(502, `Search provider returned HTTP ${response.status}.`);
  const payload = await response.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (payload.web?.results || []).flatMap((result) => result.title && result.url ? [{
    title: result.title.slice(0, 240),
    url: result.url,
    snippet: (result.description || "").slice(0, 1_200),
  }] : []);
}

async function tavilySearch(query: string, apiKey: string): Promise<SearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, search_depth: "basic", max_results: 5, include_answer: false }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new RequestError(502, `Search provider returned HTTP ${response.status}.`);
  const payload = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (payload.results || []).flatMap((result) => result.title && result.url ? [{
    title: result.title.slice(0, 240),
    url: result.url,
    snippet: (result.content || "").slice(0, 1_200),
  }] : []);
}

export async function searchExternal(query: string, env: WorkerEnv, startIndex: number): Promise<{ sources: EvidenceSource[]; warning?: string }> {
  const provider = env.SEARCH_PROVIDER || "none";
  if (provider === "none") return { sources: [], warning: "External search is not configured; the answer uses local evidence only." };
  if (!env.SEARCH_API_KEY) return { sources: [], warning: `The ${provider} search provider is selected but SEARCH_API_KEY is not configured.` };

  const results = provider === "brave"
    ? await braveSearch(query, env.SEARCH_API_KEY)
    : await tavilySearch(query, env.SEARCH_API_KEY);

  const sources = results.slice(0, 5).flatMap((result, index) => {
    try {
      const url = validatePublicUrl(result.url).toString();
      return [{
        id: `U${startIndex + index}`,
        title: result.title,
        content: result.snippet,
        evidenceType: `external_search_${provider}`,
        status: "runtime_untrusted",
        sourceUrl: url,
        trust: "untrusted_external" as const,
      }];
    } catch {
      return [];
    }
  });
  return { sources };
}
