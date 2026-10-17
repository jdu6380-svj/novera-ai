import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { EMBEDDING_DIMENSION, type EmbeddingVector } from "@/domain";
import { RetrievalRepositoryError } from "@/features/retrieval/application/retrieval-repository";

import {
  SupabaseRetrievalRepository,
  type RetrievalRpcClient,
} from "./supabase-retrieval-repository";

const KNOWLEDGE_BASE_ID = "00000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000020";
const CHUNK_ID = "00000000-0000-4000-8000-000000000030";

function queryEmbedding(): EmbeddingVector {
  const vector = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  vector[0] = 1;
  return vector;
}

function rpcRow(overrides: Record<string, unknown> = {}) {
  return {
    rank: 1,
    chunk_id: CHUNK_ID,
    document_id: DOCUMENT_ID,
    document_name: "Activation Report",
    document_version: 2,
    document_mime_type: "text/markdown",
    chunk_index: 3,
    chunk_text: "Users cannot find the next step after signup.",
    token_count: 12,
    page_start: 2,
    page_end: 2,
    start_char: 120,
    end_char: 168,
    section_path: "Activation > Friction",
    locator: {
      pageStart: 2,
      pageEnd: 2,
      startChar: 120,
      endChar: 168,
      sectionPath: "Activation > Friction",
      sourceSegments: [
        {
          sourceBlockId: "block-4",
          locator: {
            pageStart: 2,
            pageEnd: 2,
            lineStart: 8,
            lineEnd: 9,
            startChar: 120,
            endChar: 168,
          },
        },
      ],
    },
    similarity_score: 0.91,
    distance: 0.09,
    metadata: { evidence: { sourceDocumentId: DOCUMENT_ID } },
    document_metadata: { department: "Product" },
    embedding_provider: "openai",
    embedding_model: "text-embedding-3-small",
    embedding_model_version: "deployment-2026-08-02",
    embedding_dimension: EMBEDDING_DIMENSION,
    embedded_at: "2026-08-02T10:00:00.000Z",
    ...overrides,
  };
}

function clientReturning(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn<RetrievalRpcClient["rpc"]>().mockResolvedValue(result);
  return { client: { rpc } satisfies RetrievalRpcClient, rpc };
}

describe("SupabaseRetrievalRepository", () => {
  it("calls the guarded pgvector RPC and maps an evidence-ready result", async () => {
    const { client, rpc } = clientReturning({ data: [rpcRow()], error: null });
    const repository = new SupabaseRetrievalRepository(client);

    const results = await repository.matchChunks({
      queryEmbedding: queryEmbedding(),
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      topK: 8,
      similarityThreshold: 0.35,
      documentIds: [DOCUMENT_ID, DOCUMENT_ID],
    });

    expect(rpc).toHaveBeenCalledWith("match_document_chunks", {
      query_embedding: queryEmbedding(),
      knowledge_base: KNOWLEDGE_BASE_ID,
      match_count: 8,
      similarity_threshold: 0.35,
      filter_document_ids: [DOCUMENT_ID],
    });
    expect(results).toEqual([
      expect.objectContaining({
        rank: 1,
        chunkId: CHUNK_ID,
        documentId: DOCUMENT_ID,
        similarityScore: 0.91,
        locator: expect.objectContaining({
          pageStart: 2,
          lineStart: 8,
          lineEnd: 9,
          startChar: 120,
          sectionPath: "Activation > Friction",
        }),
        embedding: expect.objectContaining({
          model: "text-embedding-3-small",
          dimension: EMBEDDING_DIMENSION,
        }),
      }),
    ]);
  });

  it("normalizes an empty document filter to an unfiltered RPC query", async () => {
    const { client, rpc } = clientReturning({ data: [], error: null });
    const repository = new SupabaseRetrievalRepository(client);

    await repository.matchChunks({
      queryEmbedding: queryEmbedding(),
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      topK: 4,
      similarityThreshold: 0.5,
      documentIds: [],
    });

    expect(rpc).toHaveBeenCalledWith(
      "match_document_chunks",
      expect.objectContaining({ filter_document_ids: null }),
    );
  });

  it("rejects a query vector that cannot match the pgvector column", async () => {
    const { client, rpc } = clientReturning({ data: [], error: null });
    const repository = new SupabaseRetrievalRepository(client);

    await expect(
      repository.matchChunks({
        queryEmbedding: [1, 2],
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        topK: 8,
        similarityThreshold: 0.35,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("wraps Supabase failures at the repository boundary", async () => {
    const databaseError = { code: "57014", message: "query cancelled" };
    const { client } = clientReturning({ data: null, error: databaseError });
    const repository = new SupabaseRetrievalRepository(client);

    try {
      await repository.matchChunks({
        queryEmbedding: queryEmbedding(),
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        topK: 8,
        similarityThreshold: 0.35,
      });
      throw new Error("Expected retrieval to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(RetrievalRepositoryError);
      expect(error).toMatchObject({ code: "QUERY_FAILED", cause: databaseError });
    }
  });

  it("rejects malformed RPC rows before they reach retrieval orchestration", async () => {
    const { client } = clientReturning({
      data: [rpcRow({ similarity_score: 1.2 })],
      error: null,
    });
    const repository = new SupabaseRetrievalRepository(client);

    await expect(
      repository.matchChunks({
        queryEmbedding: queryEmbedding(),
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        topK: 8,
        similarityThreshold: 0.35,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
