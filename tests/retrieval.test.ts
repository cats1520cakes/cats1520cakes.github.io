import { describe, expect, it } from "vitest";
import { knowledgeStats, retrieveEvidence } from "../worker/retrieval";

describe("knowledge retrieval", () => {
  it("retrieves the official Q-Detection record", () => {
    const results = retrieveEvidence("What is the evidence for Q-Detection at IJCAI?", 5);
    expect(results.some((source) => source.title.includes("Q-Detection"))).toBe(true);
    expect(results.some((source) => source.sourceUrl?.includes("ijcai.org"))).toBe(true);
  });

  it("reports a non-empty, typed corpus", () => {
    const stats = knowledgeStats();
    expect(stats.chunks).toBeGreaterThan(5);
    expect(stats.evidenceTypes).toContain("official_publication");
  });
});
