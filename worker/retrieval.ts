import rawChunks from "../knowledge/chunks.json";
import type { EvidenceSource, KnowledgeChunk } from "./types";

const chunks = rawChunks as KnowledgeChunk[];
const TRUST_BY_TYPE: Record<string, EvidenceSource["trust"]> = {
  owner_confirmed: "owner_confirmed",
  official_publication: "trusted_official",
  official_preprint: "trusted_official",
  public_repository: "trusted_official",
  local_publication_record: "trusted_local",
  local_site_source: "trusted_local",
};

export function queryTerms(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9+._-]{1,}|[\p{Script=Han}]/gu) || [])].slice(0, 80);
}

function chunkScore(chunk: KnowledgeChunk, terms: string[]): number {
  if (!terms.length) return 0;
  const title = chunk.title.toLowerCase();
  const body = chunk.content.toLowerCase();
  const tags = chunk.tags.join(" ").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 5;
    if (tags.includes(term)) score += 3;
    const occurrences = body.split(term).length - 1;
    score += Math.min(occurrences, 4) * 1.2;
    if (chunk.terms.includes(term)) score += 0.8;
  }
  if (chunk.evidenceType === "official_publication") score += 0.7;
  if (chunk.evidenceType === "owner_confirmed") score += 0.4;
  return score / Math.sqrt(Math.max(1, body.length / 500));
}

export function retrieveEvidence(query: string, limit = 7): EvidenceSource[] {
  const terms = queryTerms(query);
  const ranked = chunks
    .map((chunk) => ({ chunk, score: chunkScore(chunk, terms) }))
    .filter(({ score }) => score > 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (!ranked.length) {
    for (const fallback of chunks.filter((chunk) => chunk.evidenceType === "owner_confirmed").slice(0, 2)) {
      ranked.push({ chunk: fallback, score: 0.1 });
    }
  }

  return ranked.map(({ chunk }, index) => ({
    id: `S${index + 1}`,
    title: chunk.title,
    content: chunk.content,
    evidenceType: chunk.evidenceType,
    status: chunk.status,
    sourcePath: chunk.provenance.sourcePath,
    sourceUrl: chunk.provenance.sourceUrl || undefined,
    trust: TRUST_BY_TYPE[chunk.evidenceType] || "trusted_local",
  }));
}

export function knowledgeStats() {
  return {
    chunks: chunks.length,
    evidenceTypes: [...new Set(chunks.map((chunk) => chunk.evidenceType))].sort(),
  };
}
