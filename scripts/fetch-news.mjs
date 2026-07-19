#!/usr/bin/env node
/**
 * 每日资讯同步脚本
 * 抓取 AI HOT (https://aihot.virxact.com/) 的 RSS 全量源，
 * 解析为按北京时间分组的结构化数据，写入 _data/daily_news.json。
 * 由 GitHub Actions 定时运行（见 .github/workflows/update-news.yml），
 * 也可本地手动执行：node scripts/fetch-news.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FEED_URL = "https://aihot.virxact.com/feed/all.xml";
const MAX_DAYS = 7;
const MAX_ITEMS_PER_DAY = 50;
const MAX_FEED_BYTES = 5_000_000;
const MAX_TITLE_CHARS = 500;
const MAX_SUMMARY_CHARS = 4_000;
const MAX_LABEL_CHARS = 160;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "_data", "daily_news.json");

const res = await fetch(FEED_URL, {
  headers: { "user-agent": "daily-news-sync (+https://cats1520cakes.github.io)" },
});
if (!res.ok) throw new Error(`Failed to fetch ${FEED_URL}: HTTP ${res.status}`);
const declaredBytes = Number(res.headers.get("content-length") || "0");
if (declaredBytes > MAX_FEED_BYTES) throw new Error("RSS feed is too large.");
const xml = await res.text();
if (new TextEncoder().encode(xml).byteLength > MAX_FEED_BYTES) throw new Error("RSS feed is too large.");

const cleanText = (value, maxChars) => String(value || "")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
  .trim()
  .slice(0, maxChars);

const safeHttpsUrl = (value) => {
  try {
    const url = new URL(cleanText(value, 2_048));
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return "";
    return url.toString();
  } catch {
    return "";
  }
};

const cdata = (s) => {
  const m = s.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : s;
};
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? cdata(m[1]).trim() : "";
};

const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
  .map(([, b]) => {
    const rawDesc = tag(b, "description");
    const orig = rawDesc.match(/🔗 阅读原文：(\S+)/);
    const summary = rawDesc
      .split("🔗 阅读原文：")[0]
      .replace(/\n*via AI HOT[\s\S]*$/, "")
      .trim();
    const author = tag(b, "author");
    const src = author.match(/\((.+)\)/);
    const ts = Date.parse(tag(b, "pubDate"));
    return {
      title: cleanText(tag(b, "title"), MAX_TITLE_CHARS),
      summary: cleanText(summary, MAX_SUMMARY_CHARS),
      category: cleanText(tag(b, "category"), MAX_LABEL_CHARS),
      source: cleanText(src ? src[1] : "", MAX_LABEL_CHARS),
      originalUrl: safeHttpsUrl(orig ? orig[1] : ""),
      itemUrl: safeHttpsUrl(tag(b, "link")),
      ts,
    };
  })
  .filter((it) => it.title && Number.isFinite(it.ts))
  .sort((a, b) => b.ts - a.ts);

if (items.length === 0) throw new Error("No items parsed from feed — format may have changed.");

// 按北京时间（UTC+8）分组
const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const bj = (ts) => new Date(ts + 8 * 3600 * 1000);
const days = new Map();
for (const it of items) {
  const d = bj(it.ts);
  const key = d.toISOString().slice(0, 10);
  if (!days.has(key)) days.set(key, { date: key, weekday: WEEKDAYS[d.getUTCDay()], items: [] });
  days.get(key).items.push({
    time: d.toISOString().slice(11, 16),
    title: it.title,
    summary: it.summary,
    category: it.category,
    source: it.source,
    originalUrl: it.originalUrl,
    itemUrl: it.itemUrl,
  });
}

const out = {
  updatedAt: new Date().toISOString(),
  sourceName: "AI HOT · 每日 AI 资讯",
  sourceUrl: "https://aihot.virxact.com/",
  days: [...days.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_DAYS)
    .map((d) => ({ ...d, count: Math.min(d.items.length, MAX_ITEMS_PER_DAY), items: d.items.slice(0, MAX_ITEMS_PER_DAY) })),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`OK: ${out.days.length} day(s), ${items.length} item(s) -> ${outPath}`);
