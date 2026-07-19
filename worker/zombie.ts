import { readJsonBody, RequestError, validateOrigin } from "./security";
import { authorizeAiRequest } from "./access";
import type { WorkerEnv } from "./types";

/**
 * 生化模式 AI 指挥端点。
 * 浏览器把战场快照 POST 到 /api/zombie-command，Worker 在服务端持有
 * DEEPSEEK_API_KEY，组装提示词调用 DeepSeek（v4 flash 非思考模式），
 * 校验并夹取指令后返回 { orders: [...] }。密钥永不下发到浏览器。
 */

// ---------- 快照类型与校验（服务端全量夹取，不信任客户端） ----------
const ARENA_W = 960;
const ARENA_H = 540;
const WALL = 18;
const WEAPON_KEYS = new Set(["rifle", "shotgun", "gatling", "sniper"]);
const ZOMBIE_TYPES = new Set(["w", "r", "b"]);
const CRATE_KINDS = new Set(["ammo", "med", "weapon"]);
const FOCUS_KINDS = new Set(["nearest", "brute", "none"]);
const MAX_BODY_BYTES = 16_000;

export interface ZombieSnapshot {
  wave: number;
  hp: number;
  weapon: string;
  px: number;
  py: number;
  bots: Array<{ id: number; x: number; y: number; infected: boolean }>;
  zombies: Array<{ id: number; t: string; x: number; y: number }>;
  crates: Array<{ k: string; x: number; y: number }>;
}

export interface ZombieOrder {
  id: number;
  mx: number;
  my: number;
  focus: string;
  say?: string;
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cleanSay(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, 14);
  return text || undefined;
}

export function sanitizeSnapshot(raw: unknown): ZombieSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RequestError(400, "snapshot must be a JSON object.");
  }
  const input = raw as Record<string, unknown>;
  const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

  const bots = asArray(input.bots).slice(0, 3).map((b, idx) => {
    const e = (b || {}) as Record<string, unknown>;
    return {
      id: clampNum(e.id, 0, 2, idx),
      x: clampNum(e.x, 0, ARENA_W, ARENA_W / 2),
      y: clampNum(e.y, 0, ARENA_H, ARENA_H / 2),
      infected: e.infected === true,
    };
  });
  if (bots.length === 0) throw new RequestError(400, "snapshot.bots must be a non-empty array.");

  const zombies = asArray(input.zombies).slice(0, 12).map((z, idx) => {
    const e = (z || {}) as Record<string, unknown>;
    const t = typeof e.t === "string" && ZOMBIE_TYPES.has(e.t) ? e.t : "w";
    return {
      id: clampNum(e.id, 0, 1_000_000, idx + 1),
      t,
      x: clampNum(e.x, 0, ARENA_W, ARENA_W / 2),
      y: clampNum(e.y, 0, ARENA_H, ARENA_H / 2),
    };
  });

  const crates = asArray(input.crates).slice(0, 6).map((c) => {
    const e = (c || {}) as Record<string, unknown>;
    const k = typeof e.k === "string" && CRATE_KINDS.has(e.k) ? e.k : "ammo";
    return {
      k,
      x: clampNum(e.x, 0, ARENA_W, ARENA_W / 2),
      y: clampNum(e.y, 0, ARENA_H, ARENA_H / 2),
    };
  });

  const weapon = typeof input.weapon === "string" && WEAPON_KEYS.has(input.weapon) ? input.weapon : "rifle";
  return {
    wave: clampNum(input.wave, 0, 99, 1),
    hp: clampNum(input.hp, 0, 100, 100),
    weapon,
    px: clampNum(input.px, 0, ARENA_W, ARENA_W / 2),
    py: clampNum(input.py, 0, ARENA_H, ARENA_H / 2),
    bots,
    zombies,
    crates,
  };
}

/** 模型输出的指令同样逐条夹取：坐标限制在场内，focus/say 白名单化。 */
export function sanitizeOrders(raw: unknown): ZombieOrder[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const orders = (raw as Record<string, unknown>).orders;
  if (!Array.isArray(orders)) return [];
  const out: ZombieOrder[] = [];
  for (const item of orders.slice(0, 3)) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const rawId = Number(e.id);
    if (!Number.isInteger(rawId) || rawId < 0 || rawId > 2) continue; // id 越界直接丢弃，不夹取
    const id = rawId;
    const focus = typeof e.focus === "string" && FOCUS_KINDS.has(e.focus) ? e.focus : "nearest";
    const order: ZombieOrder = {
      id,
      mx: clampNum(e.mx, WALL + 20, ARENA_W - WALL - 20, ARENA_W / 2),
      my: clampNum(e.my, WALL + 20, ARENA_H - WALL - 20, ARENA_H / 2),
      focus,
    };
    const say = cleanSay(e.say);
    if (say) order.say = say;
    out.push(order);
  }
  return out;
}

// ---------- 提示词（服务端持有，不再下发浏览器） ----------
const COMMANDER_SYSTEM_PROMPT = [
  "你是俯视射击游戏《生化模式》的战术指挥官，实时指挥 3 名幸存者 NPC（id 0/1/2）协助玩家抵御僵尸潮。",
  "场地 960x540，墙边距 18，障碍物矩形(x,y,w,h)：[190,120,96,26] [674,120,96,26] [190,394,96,26] [674,394,96,26] [452,246,56,48]。",
  "每收到一次战场快照 JSON，为每个未感染 NPC 下达约 3 秒的机动指令。只输出 JSON，格式：",
  '{"orders":[{"id":0,"mx":480,"my":320,"focus":"nearest","say":"掩护侧翼"}]}',
  "规则：",
  "1. focus 只能是 nearest（打最近的僵尸）/ brute（集火母体）/ none；",
  "2. mx,my 必须在场内，避开障碍物与僵尸贴身范围（保持 60 以上距离）；",
  "3. 与玩家保持 60~150 的支援距离，3 名 NPC 不要扎堆，分别卡住不同方向；",
  "4. 僵尸逼近玩家时向玩家靠拢掩护；玩家血量低于 40 时整体收缩防线；",
  "5. say 是不超过 10 个汉字的战术喊话，必须符合角色个性：0 号冷静沉着、1 号热血冲动、2 号胆小但忠诚。",
  "只输出 JSON，不要任何解释或 markdown 标记。",
].join("\n");

const UPSTREAM_TIMEOUT_MS = 8_000;

function providerErrorMessage(status: number): string {
  if (status === 401) return "The model provider rejected its server-side credential.";
  if (status === 402) return "The model provider account has insufficient balance.";
  if (status === 429) return "The model provider is rate-limiting requests. Please retry shortly.";
  if (status === 503) return "The model provider is temporarily overloaded.";
  return `The model provider returned HTTP ${status}.`;
}

async function parseRequest(request: Request): Promise<ZombieSnapshot> {
  const raw = await readJsonBody(request, MAX_BODY_BYTES);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RequestError(400, "Request body must be a JSON object.");
  }
  return sanitizeSnapshot((raw as Record<string, unknown>).snapshot);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handleZombieCommand(request: Request, env: WorkerEnv): Promise<Response> {
  if (!validateOrigin(request, env)) throw new RequestError(403, "Origin is not allowed.");
  await authorizeAiRequest(request, "zombie", env);

  const snapshot = await parseRequest(request);
  if (!env.DEEPSEEK_API_KEY) throw new RequestError(503, "The commander model is not configured on the server.");

  const baseUrl = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const endpoint = new URL(`${baseUrl}/chat/completions`);
  if (endpoint.protocol !== "https:") throw new RequestError(503, "The server model endpoint must use HTTPS.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || "deepseek-v4-flash",
        messages: [
          { role: "system", content: COMMANDER_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(snapshot) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.6,
        max_tokens: 400,
        stream: false,
        thinking: { type: "disabled" },
      }),
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new RequestError(504, "The commander request timed out.");
    }
    throw new RequestError(502, "The model provider could not be reached.");
  }
  clearTimeout(timer);

  if (!upstream.ok) throw new RequestError(502, providerErrorMessage(upstream.status));

  let data: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    data = (await upstream.json()) as typeof data;
  } catch {
    throw new RequestError(502, "The model provider returned an invalid response.");
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new RequestError(502, "The model provider returned an empty response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content.replace(/```json|```/g, "").trim());
  } catch {
    throw new RequestError(502, "The commander response was not valid JSON.");
  }
  return jsonResponse({ orders: sanitizeOrders(parsed) });
}
