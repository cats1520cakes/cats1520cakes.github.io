#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_MODE = process.argv.includes("--release");
const SKIP_DIRS = new Set([".git", ".codebase-mcp", ".jekyll-preview", ".wrangler", "node_modules", "vendor", ".bundle"]);
const TEXT_EXTENSIONS = new Set(["", ".css", ".html", ".js", ".json", ".jsonc", ".md", ".mjs", ".rb", ".scss", ".sh", ".toml", ".ts", ".txt", ".yml", ".yaml"]);
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{24,}\b/g,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];
const findings = [];

function isLocalSecretFile(name) {
  if (name === ".dev.vars.example" || name === ".env.example") return false;
  return name.startsWith(".dev.vars") || name.startsWith(".env");
}

function walk(directory, files = []) {
  for (const name of readdirSync(directory)) {
    const absolute = join(directory, name);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(absolute, files);
    } else if (isLocalSecretFile(name)) {
      if (RELEASE_MODE) findings.push({ path: relative(ROOT, absolute), count: 1, kind: "local secret file" });
    } else if (stats.size <= 2_000_000 && TEXT_EXTENSIONS.has(extname(name))) {
      files.push(absolute);
    }
  }
  return files;
}

for (const file of walk(ROOT)) {
  const content = readFileSync(file, "utf8");
  let count = 0;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    count += [...content.matchAll(pattern)].length;
  }
  if (count) findings.push({ path: relative(ROOT, file), count, kind: "credential-shaped value" });
}

if (findings.length) {
  console.error("Potential secret material found (values suppressed):");
  for (const finding of findings) console.error(`- ${finding.path}: ${finding.count} ${finding.kind}(s)`);
  process.exit(1);
}

console.log(RELEASE_MODE
  ? "Release secret scan passed: no local secret files or credential-shaped values found."
  : "Secret scan passed: no credential-shaped values found in source or static output.");
