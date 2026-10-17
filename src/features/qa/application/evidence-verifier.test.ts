import { describe, expect, it } from "vitest";

import type { RetrievalEngineResult } from "@/features/retrieval/application/retrieval-engine";
import type { SourceVerificationRecord } from "@/features/qa/domain/qa";
import type { EvidenceSourceRepository } from "./evidence-source-repository";
import { EvidenceVerificationLayer } from "./evidence-verifier";

const chunk = {
  rank: 1,
  citationLabel: "[S1]",
  chunkId: "chunk-1",
  documentId: "doc-1",
  documentName: "Feedback report",
  chunkIndex: 0,
  text: "Users cannot find the next step after registration.",
  contextText: "Users cannot find the next step after registration.",
  renderedText: "[S1]\nUsers cannot find the next step after registration.",
  similarityScore: 0.82,
  metadata: {},
  locator: { pageStart: 12, pageEnd: 12, sectionPath: "Feedback" },
  estimatedContextTokens: 10,
  truncated: false,
};

const retrieval: RetrievalEngineResult = {
  query: "Why are users leaving?",
  taskUnderstanding: {
    requestedTaskType: "analysis",
    understoodTaskType: "analysis",
    confidence: 0.9,
    normalizedQuery: "Why are users leaving?",
    signals: [],
    details: {},
  },
  retrieval: {
    query: "Why are users leaving?",
    topK: 8,
    similarityThreshold: 0.35,
    chunks: [
      {
        ...chunk,
        documentVersion: 1,
        documentMimeType: "text/plain",
        distance: 0.18,
        tokenCount: 10,
        documentMetadata: {},
        embedding: {
          provider: "fake",
          model: "fake-embedding",
          modelVersion: "v1",
          dimension: 1536,
          embeddedAt: "2026-08-04T00:00:00.000Z",
        },
        locator: {
          pageStart: 12,
          pageEnd: 12,
          lineStart: null,
          lineEnd: null,
          startChar: null,
          endChar: null,
          sectionPath: "Feedback",
          sourceSegments: [],
        },
      },
    ],
    embedding: {
      provider: "fake",
      model: "fake-embedding",
      modelVersion: "v1",
      dimensions: 1536,
      embeddedAt: "2026-08-04T00:00:00.000Z",
      usageTokens: 5,
    },
  },
  context: {
    context: chunk.renderedText,
    chunks: [chunk],
    stats: {
      received: 1,
      selected: 1,
      estimatedTokens: 10,
      characters: chunk.renderedText.length,
      truncated: 0,
      dropped: {
        invalid: 0,
        belowThreshold: 0,
        duplicate: 0,
        perDocumentLimit: 0,
        maxChunks: 0,
        budget: 0,
      },
    },
    config: {
      minimumSimilarity: 0.35,
      maxChunks: 8,
      maxChunksPerDocument: 3,
      maxTokens: 2400,
      maxCharacters: 12000,
    },
  },
};

const source: SourceVerificationRecord = {
  chunkId: "chunk-1",
  documentId: "doc-1",
  documentName: "Feedback report",
  documentVersion: 1,
  documentStatus: "ready",
  chunkText: chunk.text,
  locator: { page_start: 12, page_end: 12 },
};

class MemorySourceRepository implements EvidenceSourceRepository {
  constructor(private readonly records: SourceVerificationRecord[]) {}

  async loadByChunkIds(): Promise<SourceVerificationRecord[]> {
    return this.records;
  }
}

describe("EvidenceVerificationLayer", () => {
  it("accepts only exact quotes from the current READY retrieval set", async () => {
    const result = await new EvidenceVerificationLayer(
      new MemorySourceRepository([source]),
    ).verify(
      {
        answer: "Users leave because onboarding is unclear.",
        claims: [
          {
            claimText: "Users cannot find the next step after registration.",
            claimType: "fact",
            weight: 1,
            evidence: [
              {
                citationLabel: "[S1]",
                quote: "Users cannot find the next step after registration.",
              },
            ],
          },
        ],
        limitations: [],
        insufficientEvidence: false,
      },
      retrieval,
    );

    expect(result.claims[0]?.supportStatus).toBe("full");
    expect(result.validEvidenceCount).toBe(1);
    expect(result.claims[0]?.evidence[0]?.documentId).toBe("doc-1");
  });

  it("downgrades claims when a citation or quote cannot be verified", async () => {
    const result = await new EvidenceVerificationLayer(
      new MemorySourceRepository([{ ...source, documentStatus: "not_ready" }]),
    ).verify(
      {
        answer: "Unknown",
        claims: [
          {
            claimText: "Unsupported claim",
            claimType: "analysis",
            weight: 2,
            evidence: [
              { citationLabel: "[S9]", quote: "not in context" },
              { citationLabel: "[S1]", quote: "wrong quote" },
            ],
          },
        ],
        limitations: [],
        insufficientEvidence: false,
      },
      retrieval,
    );

    expect(result.claims[0]?.supportStatus).toBe("unsupported");
    expect(result.invalidEvidenceCount).toBe(2);
    expect(result.details).toMatchObject({
      rejection_reasons: {
        citation_not_in_context: 1,
        source_document_not_ready: 1,
      },
    });
  });
});
