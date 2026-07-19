export type AgentMode = "qa" | "challenge" | "fit";
export type AiScope = "agent" | "zombie" | "elite";

export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AgentHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface AgentRequestBody {
  mode: AgentMode;
  question: string;
  contextUrl?: string;
  useSearch: boolean;
  history: AgentHistoryItem[];
}

export interface KnowledgeChunk {
  id: string;
  title: string;
  content: string;
  evidenceType: string;
  status: string;
  provenance: {
    originFile: string;
    sourcePath: string;
    sourceUrl: string | null;
    startLine: number | null;
  };
  tags: string[];
  terms: string[];
}

export interface EvidenceSource {
  id: string;
  title: string;
  content: string;
  evidenceType: string;
  status: string;
  sourcePath?: string;
  sourceUrl?: string;
  trust: "trusted_local" | "trusted_official" | "owner_confirmed" | "untrusted_external";
}

export interface WorkerEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
  SEARCH_PROVIDER?: "none" | "brave" | "tavily";
  SEARCH_API_KEY?: string;
  ALLOWED_ORIGINS?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_ALLOWED_HOSTNAMES?: string;
  AI_SESSION_SECRET?: string;
  SESSION_RATE_LIMITER?: RateLimiterBinding;
  AGENT_RATE_LIMITER?: RateLimiterBinding;
  GAME_RATE_LIMITER?: RateLimiterBinding;
}
