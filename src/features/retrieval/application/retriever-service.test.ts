import { describe, expect, it, vi } from "vitest";

import {
  EMBEDDING_DIMENSION,
  type EmbeddingVector,
} from "@/domain";
import type {
  MatchChunksInput,
  RetrievalRepository,
} from "@/features/retrieval/application/retrieval-repository";
import { RetrievalRepositoryError } from "@/features/retrieval/application/retrieval-repository";
import type { RetrieverConfig } from "@/features/retrieval/application/retriever-config";
import type { RetrievedChunk } from "@/features/retrieval/domain/retrieval";
import type { EmbeddingBatch, EmbeddingProvider } from "@/providers";

import { RetrievalError } from "./retrieval-error";
import { RetrieverService } from "./retriever-service";

const KNOWLEDGE_BASE_ID = "00000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000020";
const CHUNK_ID = "00000000-0000-4000-8000-000000000030";
const NOW = "2026-08-03T00:00:00.000Z";

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

function chunk(): RetrievedChunk {
  return {
    rank: 1,
    chunkId: CHUNK_ID,
    documentId: DOCUMENT_ID,
    documentName: "Activation Report",
    documentVersion: 1,
    documentMimeType: "text/markdown",
    chunkIndex: 0,
    text: "Users cannot find the next step after signup.",
    tokenCount: 10,
    similarityScore: 0.91,
    distance: 0.09,
    metadata: {},
    documentMetadata: {},
    locator: {
      pageStart: 1,
      pageEnd: 1,
      lineStart: 4,
      lineEnd: 4,
      startChar: 30,
      endChar: 78,
      sectionPath: "Activation > Friction",
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

  constructor(private readonly batchOverride?: Partial<EmbeddingBatch>) {}

  async embed(): Promise<EmbeddingBatch> {
    return {
      provider: this.provider,
      model: this.model,
      modelVersion: this.modelVersion,
      dimensions: this.dimensions,
      embeddedAt: NOW,
      vectors: [vector()],
      usageTokens: 4,
      ...this.batchOverride,
    };
  }
}

class FakeRepository implements RetrievalRepository {
  readonly matchChunks = vi.fn(
    async (input: MatchChunksInput): Promise<RetrievedChunk[]> => {
      void input;
      return [chunk()];
    },
  );
}

describe("RetrieverService", () => {
  it("embeds a normalized query and returns evidence-ready top-k chunks", async () => {
    const repository = new FakeRepository();
    const service = new RetrieverService(
      repository,
      new FakeEmbeddingProvider(),
      config,
    );

    const result = await service.retrieve({
      query: "  为什么\n用户流失增加？  ",
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      documentIds: [DOCUMENT_ID, DOCUMENT_ID],
    });

    expect(repository.matchChunks).toHaveBeenCalledWith({
      queryEmbedding: vector(),
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      topK: 12,
      similarityThreshold: 0.35,
      documentIds: [DOCUMENT_ID],
    });
    expect(result).toMatchObject({
      query: "为什么 用户流失增加?",
      topK: 12,
      similarityThreshold: 0.35,
      chunks: [expect.objectContaining({ chunkId: CHUNK_ID })],
      embedding: {
        provider: "openai",
        model: "text-embedding-3-small",
        modelVersion: "text-embedding-3-small",
        dimensions: EMBEDDING_DIMENSION,
        embeddedAt: NOW,
        usageTokens: 4,
      },
    });
    expect(result).not.toHaveProperty("queryEmbedding");
  });

  it("honors bounded request-level retrieval controls", async () => {
    const repository = new FakeRepository();
    const service = new RetrieverService(
      repository,
      new FakeEmbeddingProvider(),
      config,
    );

    await service.retrieve({
      query: "refund policy",
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      topK: 4,
      similarityThreshold: 0.6,
    });

    expect(repository.matchChunks).toHaveBeenCalledWith(
      expect.objectContaining({ topK: 4, similarityThreshold: 0.6 }),
    );
  });

  it.each([
    [{ query: "", knowledgeBaseId: KNOWLEDGE_BASE_ID }, "A non-empty query"],
    [
      { query: "valid", knowledgeBaseId: KNOWLEDGE_BASE_ID, topK: 51 },
      "topK must be an integer",
    ],
    [
      {
        query: "valid",
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        similarityThreshold: -0.1,
      },
      "similarityThreshold must be between 0 and 1",
    ],
  ])("rejects invalid retrieval input", async (input, message) => {
    const service = new RetrieverService(
      new FakeRepository(),
      new FakeEmbeddingProvider(),
      config,
    );

    await expect(service.retrieve(input)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining(message),
    });
  });

  it("rejects a malformed single-query embedding batch", async () => {
    const service = new RetrieverService(
      new FakeRepository(),
      new FakeEmbeddingProvider({ vectors: [] }),
      config,
    );

    await expect(
      service.retrieve({ query: "refund", knowledgeBaseId: KNOWLEDGE_BASE_ID }),
    ).rejects.toMatchObject({ code: "QUERY_EMBEDDING_FAILED", httpStatus: 502 });
  });

  it("maps repository failures without leaking provider or database details", async () => {
    const repository = new FakeRepository();
    repository.matchChunks.mockRejectedValueOnce(
      new RetrievalRepositoryError("database detail", "QUERY_FAILED"),
    );
    const service = new RetrieverService(
      repository,
      new FakeEmbeddingProvider(),
      config,
    );

    try {
      await service.retrieve({ query: "refund", knowledgeBaseId: KNOWLEDGE_BASE_ID });
      throw new Error("Expected retrieval to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(RetrievalError);
      expect(error).toMatchObject({
        code: "VECTOR_RETRIEVAL_FAILED",
        httpStatus: 500,
        details: { repository_code: "QUERY_FAILED" },
      });
      expect((error as Error).message).not.toContain("database detail");
    }
  });
});
