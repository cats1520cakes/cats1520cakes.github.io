import { readJsonBody, RequestError, validateOrigin } from "./security";
import { authorizeAiRequest } from "./access";
import type { WorkerEnv } from "./types";

/**
 * 3D 生化战场「精英变异体」AI 指挥端点。
 * 浏览器把战场快照 POST 到 /api/elite-command，Worker 在服务端持有
 * DEEPSEEK_API_KEY，组装提示词调用 DeepSeek（v4 flash 非思考模式），
 * 校验并夹取指令后返回 { orders: [...] }。密钥永不下发到浏览器。
 */

// ---------- 快照类型与校验（服务端全量夹取，不信任客户端） ----------
const FIELD_RANGE = 40; // 3D 场地坐标 [-40, 40]
const MAX_PLAYER_Y = 12;
const MAX_DIST = 80;
const MAX_ZOMBIES_NEAR = 40;
const MAX_BODY_BYTES = 8_000;
const ELITE_ACTIONS = new Set(["stalk", "charge", "spit", "roar", "slam", "summon"]);

export interface EliteUnit {
  id: number;
  x: number;
  z: number;
  hp: number;
  dist: number;
  canSpit: boolean;
  canCharge: boolean;
  canRoar: boolean;
  canSlam: boolean;
  canSummon: boolean;
}

export interface EliteSnapshot {
  wave: number;
  playerX: number;
  playerY: number;
  playerZ: number;
  playerHp: number;
  playerHigh: boolean;
  zombiesNear: number;
  elites: EliteUnit[];
}

export interface EliteOrder {
  id: number;
  action: string;
  tx: number;
  tz: number;
  say?: string;
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 3D 坐标/距离是浮点，夹取但不取整。 */
function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanSay(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, 8);
  return text || undefined;
}

export function sanitizeSnapshot(raw: unknown): EliteSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RequestError(400, "snapshot must be a JSON object.");
  }
  const input = raw as Record<string, unknown>;
  const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

  const elites: EliteUnit[] = [];
  for (const item of asArray(input.elites).slice(0, 3)) {
    const e = (item || {}) as Record<string, unknown>;
    const rawId = Number(e.id);
    if (!Number.isInteger(rawId) || rawId < 0 || rawId > 2) continue; // id 越界直接丢弃，不夹取
    elites.push({
      id: rawId,
      x: clampFloat(e.x, -FIELD_RANGE, FIELD_RANGE, 0),
      z: clampFloat(e.z, -FIELD_RANGE, FIELD_RANGE, 0),
      hp: clampNum(e.hp, 0, 1_000, 100),
      dist: clampFloat(e.dist, 0, MAX_DIST, MAX_DIST),
      canSpit: e.canSpit === true,
      canCharge: e.canCharge === true,
      canRoar: e.canRoar === true,
      canSlam: e.canSlam === true,
      canSummon: e.canSummon === true,
    });
  }

  return {
    wave: clampNum(input.wave, 0, 99, 1),
    playerX: clampFloat(input.playerX, -FIELD_RANGE, FIELD_RANGE, 0),
    playerY: clampFloat(input.playerY, 0, MAX_PLAYER_Y, 0),
    playerZ: clampFloat(input.playerZ, -FIELD_RANGE, FIELD_RANGE, 0),
    playerHp: clampNum(input.playerHp, 0, 100, 100),
    playerHigh: input.playerHigh === true,
    zombiesNear: clampNum(input.zombiesNear, 0, MAX_ZOMBIES_NEAR, 0),
    elites,
  };
}

/** 模型输出的指令同样逐条夹取：id 必须出现在快照里，action 白名单化，坐标限制在场内。 */
export function sanitizeOrders(raw: unknown, validIds: Set<number>): EliteOrder[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const orders = (raw as Record<string, unknown>).orders;
  if (!Array.isArray(orders)) return [];
  const out: EliteOrder[] = [];
  for (const item of orders.slice(0, 3)) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const rawId = Number(e.id);
    if (!Number.isInteger(rawId) || !validIds.has(rawId)) continue; // 快照里没有的 id 直接丢弃
    if (typeof e.action !== "string" || !ELITE_ACTIONS.has(e.action)) continue; // 非法 action 直接丢弃
    const order: EliteOrder = {
      id: rawId,
      action: e.action,
      tx: clampFloat(e.tx, -FIELD_RANGE, FIELD_RANGE, 0),
      tz: clampFloat(e.tz, -FIELD_RANGE, FIELD_RANGE, 0),
    };
    const say = cleanSay(e.say);
    if (say) order.say = say;
    out.push(order);
  }
  return out;
}

// ---------- 提示词（服务端持有，不再下发浏览器） ----------
const COMMANDER_SYSTEM_PROMPT = [
  "你是生化战场精英变异体指挥官，操控最多 3 只精英怪（id 0/1/2）猎杀人类玩家。",
  "精英技能强悍但行动缓慢，每次决策管 ~4 秒。",
  "每收到一次战场快照 JSON，为每只精英下达一条指令。只输出 JSON，格式：",
  '{"orders":[{"id":0,"action":"spit","tx":3.5,"tz":-8.2,"say":"撕碎你"}]}',
  "action 白名单：stalk（逼近）/ charge（狂暴冲刺）/ spit（瘟疫吐息·远程）/ roar（恐惧咆哮·强化尸群）/ slam（重力震击·近身AOE）/ summon（召唤小怪）。",
  "规则：",
  "1. dist<6 优先 slam；",
  "2. dist 6~18 选 charge 或 spit（playerHigh=true 时只有 spit 和 summon 有效，优先 spit）；",
  "3. dist>18 用 stalk 逼近；",
  "4. zombiesNear<3 且 canSummon 时考虑 summon 攒尸潮；",
  "5. 玩家 playerHp<35 时更激进，canRoar 时用 roar 强化周围僵尸；",
  "6. can*=false 的技能禁止选择；",
  "7. tx/tz 给技能瞄准点或移动目标点（场上坐标，范围 [-40,40]）；",
  "8. say 是不超过 8 个汉字的凶狠怪物口吻。",
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

async function parseRequest(request: Request): Promise<EliteSnapshot> {
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

export async function handleEliteCommand(request: Request, env: WorkerEnv): Promise<Response> {
  if (!validateOrigin(request, env)) throw new RequestError(403, "Origin is not allowed.");
  await authorizeAiRequest(request, "elite", env);

  const snapshot = await parseRequest(request);
  // 场上没有精英时直接返回空指令，不消耗上游调用（省钱）。
  if (snapshot.elites.length === 0) return jsonResponse({ orders: [] });
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
        temperature: 0.7,
        max_tokens: 300,
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
  const validIds = new Set(snapshot.elites.map((elite) => elite.id));
  return jsonResponse({ orders: sanitizeOrders(parsed, validIds) });
}
