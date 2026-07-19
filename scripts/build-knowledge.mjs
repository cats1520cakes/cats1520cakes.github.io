#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KNOWLEDGE_DIR = join(ROOT, "knowledge");
const CHUNKS_PATH = join(KNOWLEDGE_DIR, "chunks.json");
const MANIFEST_PATH = join(KNOWLEDGE_DIR, "manifest.json");
const REPORT_PATH = join(KNOWLEDGE_DIR, "report.md");
const REGISTRY_PATH = join(KNOWLEDGE_DIR, "sources.json");
const MAX_CHARS = 1800;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const posixPath = (value) => value.split("\\").join("/");
const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
};

function listMarkdownSources() {
  const paths = [join(ROOT, "_pages", "cv.md")];
  const publications = join(ROOT, "_publications");
  if (existsSync(publications)) {
    for (const name of readdirSync(publications).sort()) {
      if (name.endsWith(".md")) paths.push(join(publications, name));
    }
  }
  return paths.filter(existsSync);
}

function parseFrontMatter(raw) {
  if (!raw.startsWith("---\n")) return { data: {}, body: raw, bodyStart: 1 };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { data: {}, body: raw, bodyStart: 1 };
  const front = raw.slice(4, end).split("\n");
  const data = {};
  for (const line of front) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    data[match[1]] = match[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return {
    data,
    body: raw.slice(end + 5),
    bodyStart: raw.slice(0, end + 5).split("\n").length,
  };
}

function cleanMarkdown(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/[`*_>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return [...new Set((value.toLowerCase().match(/[a-z0-9][a-z0-9+._-]{1,}|[\p{Script=Han}]/gu) || []))].slice(0, 160);
}

function chunkId(originFile, heading, startLine, content) {
  return `kb_${sha256(`${originFile}|${heading}|${startLine}|${content.slice(0, 120)}`).slice(0, 16)}`;
}

function makeChunk({ originFile, title, content, evidenceType, status, sourcePath, sourceUrl, startLine, tags = [] }) {
  const clean = cleanMarkdown(content);
  return {
    id: chunkId(originFile, title, startLine, clean),
    title,
    content: clean,
    evidenceType,
    status,
    provenance: {
      originFile,
      sourcePath,
      sourceUrl: sourceUrl || null,
      startLine: startLine || null,
    },
    tags,
    terms: tokenize(`${title} ${clean} ${tags.join(" ")}`),
  };
}

function chunksFromRegistry(registry) {
  return registry.records.map((record, index) => makeChunk({
    originFile: "knowledge/sources.json",
    title: record.title,
    content: record.text,
    evidenceType: record.evidenceType,
    status: record.status,
    sourcePath: record.sourcePath,
    sourceUrl: record.sourceUrl,
    startLine: index + 1,
    tags: record.tags || [],
  }));
}

function chunksFromMarkdown(absolutePath) {
  const originFile = posixPath(relative(ROOT, absolutePath));
  const raw = readFileSync(absolutePath, "utf8");
  const { data, body, bodyStart } = parseFrontMatter(raw);
  const lines = body.split("\n");
  const chunks = [];
  let heading = data.title || originFile;
  let buffer = [];
  let startLine = bodyStart;

  const flush = () => {
    const text = cleanMarkdown(buffer.join("\n"));
    buffer = [];
    if (text.length < 35) return;
    for (let offset = 0; offset < text.length; offset += MAX_CHARS) {
      const content = text.slice(offset, offset + MAX_CHARS);
      chunks.push(makeChunk({
        originFile,
        title: heading,
        content,
        evidenceType: originFile.startsWith("_publications/") ? "local_publication_record" : "local_site_source",
        status: data.venue?.toLowerCase().includes("arxiv") ? "preprint" : "published_site_content",
        sourcePath: `${originFile}${startLine ? `#L${startLine}` : ""}`,
        sourceUrl: data.paperurl || null,
        startLine,
        tags: [data.venue, data.collection, data.category].filter(Boolean),
      }));
    }
  };

  lines.forEach((line, index) => {
    const markdownHeading = line.match(/^#{1,4}\s+(.+)$/);
    const setextHeading = index + 1 < lines.length && /^={3,}\s*$/.test(lines[index + 1]);
    if (markdownHeading || setextHeading) {
      flush();
      heading = cleanMarkdown(markdownHeading ? markdownHeading[1] : line) || heading;
      startLine = bodyStart + index + (setextHeading ? 2 : 1);
      return;
    }
    if (/^={3,}\s*$/.test(line)) return;
    if (!buffer.length && line.trim()) startLine = bodyStart + index;
    buffer.push(line);
  });
  flush();
  return chunks;
}

const registry = readJson(REGISTRY_PATH, { records: [], candidates: [] });
if (!Array.isArray(registry.records) || registry.records.length === 0) {
  throw new Error("knowledge/sources.json must contain at least one source record");
}

const sourceFiles = [REGISTRY_PATH, ...listMarkdownSources()];
const previousManifest = readJson(MANIFEST_PATH, { files: [] });
const previousChunks = readJson(CHUNKS_PATH, []);
const previousHashes = new Map((previousManifest.files || []).map((file) => [file.path, file.sha256]));
const priorByOrigin = new Map();
for (const chunk of previousChunks) {
  const origin = chunk?.provenance?.originFile;
  if (!origin) continue;
  if (!priorByOrigin.has(origin)) priorByOrigin.set(origin, []);
  priorByOrigin.get(origin).push(chunk);
}

const files = [];
const chunks = [];
const changed = [];
const unchanged = [];

for (const absolutePath of sourceFiles) {
  const originFile = posixPath(relative(ROOT, absolutePath));
  const hash = sha256(readFileSync(absolutePath));
  const canReuse = previousHashes.get(originFile) === hash && priorByOrigin.has(originFile);
  const nextChunks = canReuse
    ? priorByOrigin.get(originFile)
    : originFile === "knowledge/sources.json"
      ? chunksFromRegistry(registry)
      : chunksFromMarkdown(absolutePath);

  chunks.push(...nextChunks);
  files.push({ path: originFile, sha256: hash, chunks: nextChunks.length });
  (canReuse ? unchanged : changed).push(originFile);
}

chunks.sort((a, b) => a.id.localeCompare(b.id));
const generatedAt = new Date().toISOString();
const corpusSha256 = sha256(JSON.stringify(chunks));
const manifest = {
  version: 1,
  generatedAt,
  corpusSha256,
  chunkCount: chunks.length,
  files,
  changed,
  unchanged,
};

const evidenceCounts = chunks.reduce((counts, chunk) => {
  counts[chunk.evidenceType] = (counts[chunk.evidenceType] || 0) + 1;
  return counts;
}, {});

const report = [
  "# Knowledge Base Build Report",
  "",
  `Generated: ${generatedAt}`,
  `Corpus SHA-256: \`${corpusSha256}\``,
  `Chunks: ${chunks.length}`,
  "",
  "## Incremental update",
  "",
  `- Changed sources: ${changed.length ? changed.map((path) => `\`${path}\``).join(", ") : "none"}`,
  `- Reused sources: ${unchanged.length ? unchanged.map((path) => `\`${path}\``).join(", ") : "none"}`,
  "",
  "## Evidence types",
  "",
  ...Object.entries(evidenceCounts).sort().map(([type, count]) => `- \`${type}\`: ${count}`),
  "",
  "## Candidate projects not promoted to facts",
  "",
  ...(registry.candidates || []).map((candidate) => `- **${candidate.name}** — \`${candidate.status}\`: ${candidate.reason}`),
  "",
  "## Source policy",
  "",
  "Owner-confirmed current profile facts and official publication pages take precedence over older homepage text. External search results are runtime-only untrusted context and are never written into this corpus automatically.",
  "",
].join("\n");

writeFileSync(CHUNKS_PATH, `${JSON.stringify(chunks, null, 2)}\n`);
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(REPORT_PATH, report);

console.log(`Knowledge base: ${chunks.length} chunks (${changed.length} rebuilt, ${unchanged.length} reused sources)`);
