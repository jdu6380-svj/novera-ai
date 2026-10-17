import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSION, type EmbeddingVector } from "@/domain";
import type {
  MatchChunksInput,
  RetrievalRepository,
} from "@/features/retrieval/application/retrieval-repository";
import type { RetrieverConfig } from "@/features/retrieval/application/retriever-config";
import { RetrieverService } from "@/features/retrieval/application/retriever-service";
import type { RetrievedChunk } from "@/features/retrieval/domain/retrieval";
import type { EmbeddingBatch, EmbeddingProvider } from "@/providers";

import { RetrievalEngine } from "./retrieval-engine";

const KNOWLEDGE_BASE_ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-08-04T00:00:00.000Z";

const config: RetrieverConfig = {
  defaultTopK: 12,
  maximumTopK: 50,
  defaultSimilarityThreshold: 0.35,
  maximumQueryCharacters: 4_000,
};

function vector(): EmbeddingVector {
  const value = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  value[0] = 1;
  return value;
}

function chunk(index: number, similarityScore: number): RetrievedChunk {
  return {
    rank: index + 1,
    chunkId: `chunk-${index}`,
    documentId: index < 4 ? "document-a" : "document-b",
    documentName: index < 4 ? "Activation Report" : "Feedback Report",
    documentVersion: 1,
    documentMimeType: "text/markdown",
    chunkIndex: index,
    text: `Evidence text ${index}`,
    tokenCount: 4,
    similarityScore,
    distance: 1 - similarityScore,
    metadata: {},
    documentMetadata: {},
    locator: {
      pageStart: index + 1,
      pageEnd: index + 1,
      lineStart: null,
      lineEnd: null,
      startChar: index * 20,
      endChar: index * 20 + 15,
      sectionPath: `Section ${index}`,
      sourceSegments: [],
    },
    embedding: {
      provider: "openai",
      model: "text-embedding-3-small",
      modelVersion: "text-embedding-3-small",
      dimension: EMBEDDING_DIMENSION,
      embeddedAt: NOW,
    },
  };
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "openai";
  readonly model = "text-embedding-3-small";
  readonly modelVersion = "text-embedding-3-small";
  readonly dimensions = EMBEDDING_DIMENSION;

  async embed(): Promise<EmbeddingBatch> {
    return {
      provider: this.provider,
      model: this.model,
      modelVersion: this.modelVersion,
      dimensions: this.dimensions,
      embeddedAt: NOW,
      vectors: [vector()],
      usageTokens: 3,
    };
  }
}

class FakeRepository implements RetrievalRepository {
  async matchChunks(input: MatchChunksInput): Promise<RetrievedChunk[]> {
    void input;
    return Array.from({ length: 10 }, (_, index) => chunk(index, 0.95 - index * 0.04));
  }
}

describe("RetrievalEngine", () => {
  it("runs task understanding, retrieval, and context selection as one query flow", async () => {
    const engine = new RetrievalEngine(
      new RetrieverService(new FakeRepository(), new FakeEmbeddingProvider(), config),
    );

    const result = await engine.execute({
      query: "分析为什么新用户流失增加？",
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
    });

    expect(result.taskUnderstanding).toMatchObject({
      requestedTaskType: "auto",
      understoodTaskType: "analysis",
    });
    expect(result.retrieval.chunks).toHaveLength(10);
    expect(result.context.chunks.length).toBeLessThan(result.retrieval.chunks.length);
    expect(result.context.chunks.every((item) => item.similarityScore >= 0.35)).toBe(true);
    expect(result.context.stats.dropped.perDocumentLimit).toBeGreaterThan(0);
    expect(result.context.context).toContain("[S1]");
  });

  it("honors an explicit task type while keeping the retrieval query normalized", async () => {
    const engine = new RetrievalEngine(
      new RetrieverService(new FakeRepository(), new FakeEmbeddingProvider(), config),
    );

    const result = await engine.execute({
      query: "  Compare\nplans  ",
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      requestedTaskType: "qa",
      similarityThreshold: 0.6,
    });

    expect(result.query).toBe("Compare plans");
    expect(result.taskUnderstanding).toMatchObject({
      requestedTaskType: "qa",
      understoodTaskType: "qa",
      confidence: 1,
    });
    expect(result.context.config.minimumSimilarity).toBe(0.6);
  });
});
