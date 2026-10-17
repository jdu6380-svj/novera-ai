import { describe, expect, it } from "vitest";

import { StructuredDocumentChunker, estimateTokenCount } from "./chunker";
import { NormalizerLayer } from "./normalizer";
import { MarkdownDocumentParser, type DocumentProcessingSource } from "./parser";

const source: DocumentProcessingSource = {
  documentId: "00000000-0000-4000-8000-000000000012",
  displayName: "Churn Analysis",
  mimeType: "text/markdown",
  fileExtension: "md",
  metadata: {},
  content: new TextEncoder().encode(
    "# Churn Analysis\n\n## Causes\n\nUsers cannot find activation. Customers abandon checkout. Support receives repeated questions. The onboarding flow has no clear next action.",
  ),
};

describe("Structured Chunker", () => {
  it("keeps section paths, source document identity, evidence segments, and deterministic hashes", async () => {
    const parsed = await new MarkdownDocumentParser().parse(source);
    const normalized = new NormalizerLayer().normalize(parsed);
    const chunks = new StructuredDocumentChunker({ maxTokens: 12, overlapTokens: 2 }).chunk(
      normalized,
    );

    expect(chunks.length).toBeGreaterThan(1);
    const causesChunk = chunks.find((chunk) => chunk.sectionPath.includes("Causes"));
    expect(causesChunk).toBeDefined();
    expect(causesChunk?.documentId).toBe(source.documentId);
    expect(causesChunk?.sectionPath).toEqual(["Churn Analysis", "Causes"]);
    expect(causesChunk?.sourceSegments.length).toBeGreaterThan(0);
    expect(causesChunk?.textHash).toMatch(/^[a-f0-9]{64}$/);
    expect(chunks.every((chunk) => chunk.tokenCount === estimateTokenCount(chunk.text))).toBe(true);
    expect(chunks.every((chunk) => chunk.metadata.evidence === undefined)).toBe(true);
  });

  it("rejects an invalid overlap configuration", () => {
    expect(() => new StructuredDocumentChunker({ maxTokens: 4, overlapTokens: 4 })).toThrow(
      "overlapTokens",
    );
  });
});
