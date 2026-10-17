import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_KNOWLEDGE_BASE_ID,
  EMBEDDING_DIMENSION,
} from "@/domain";
import type { RetrievalEngineResult } from "@/features/retrieval/application/retrieval-engine";
import { RetrievalError } from "@/features/retrieval/application/retrieval-error";
import type { RetrievedChunk } from "@/features/retrieval/domain/retrieval";

import {
  parseRetrievalRequest,
  retrievalErrorResponse,
  retrievalResultToHttp,
} from "./retrieval-http";

const TRACE_ID = "00000000-0000-4000-8000-000000000099";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000020";
const CHUNK_ID = "00000000-0000-4000-8000-000000000030";
const NOW = "2026-08-04T00:00:00.000Z";

function retrievedChunk(): RetrievedChunk {
  return {
    rank: 1,
    chunkId: CHUNK_ID,
    documentId: DOCUMENT_ID,
    documentName: "Activation Report",
    documentVersion: 2,
    documentMimeType: "text/markdown",
    chunkIndex: 3,
    text: "Users cannot find the next action after signup.",
    tokenCount: 10,
    similarityScore: 0.91,
    distance: 0.09,
    metadata: { evidence: { sourceDocumentId: DOCUMENT_ID } },
    documentMetadata: { department: "Product" },
    locator: {
      pageStart: 2,
      pageEnd: 2,
      lineStart: 8,
      lineEnd: 9,
      startChar: 120,
      endChar: 168,
      sectionPath: "Activation > Friction",
      sourceSegments: [
        {
          sourceBlockId: "block-4",
          pageStart: 2,
          pageEnd: 2,
          lineStart: 8,
          lineEnd: 9,
          startChar: 120,
          endChar: 168,
        },
      ],
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

function engineResult(): RetrievalEngineResult {
  const chunk = retrievedChunk();
  const renderedText = [
    "[S1]",
    "Source: Activation Report",
    `Trace: document_id=${DOCUMENT_ID}; chunk_id=${CHUNK_ID}; chunk_index=3`,
    "Location: section Activation > Friction | page 2 | line 8-9 | chars 120-168",
    "Content:",
    chunk.text,
  ].join("\n");

  return {
    query: "Why is activation declining?",
    taskUnderstanding: {
      requestedTaskType: "auto",
      understoodTaskType: "analysis",
      confidence: 0.9,
      normalizedQuery: "Why is activation declining?",
      signals: [
        {
          id: "analysis-cause",
          taskType: "analysis",
          matchedText: "why",
          weight: 3.7,
        },
      ],
      details: { classifier: "novera-task-understanding-rules" },
    },
    retrieval: {
      query: "Why is activation declining?",
      topK: 12,
      similarityThreshold: 0.35,
      chunks: [chunk],
      embedding: {
        provider: "openai",
        model: "text-embedding-3-small",
        modelVersion: "text-embedding-3-small",
        dimensions: EMBEDDING_DIMENSION,
        embeddedAt: NOW,
        usageTokens: 6,
      },
    },
    context: {
      context: renderedText,
      chunks: [
        {
          chunkId: chunk.chunkId,
          documentId: chunk.documentId,
          documentName: chunk.documentName,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
          similarityScore: chunk.similarityScore,
          metadata: chunk.metadata,
          locator: chunk.locator,
          rank: 1,
          citationLabel: "[S1]",
          contextText: chunk.text,
          renderedText,
          estimatedContextTokens: 40,
          truncated: false,
        },
      ],
      stats: {
        received: 1,
        selected: 1,
        estimatedTokens: 40,
        characters: renderedText.length,
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
        maxTokens: 2_400,
        maxCharacters: 12_000,
      },
    },
  };
}

describe("retrieval HTTP contract", () => {
  it("parses a minimal request with stable MVP defaults", () => {
    expect(parseRetrievalRequest({ query: " Refund policy? " })).toEqual({
      query: "Refund policy?",
      knowledgeBaseId: DEFAULT_KNOWLEDGE_BASE_ID,
      requestedTaskType: "auto",
      topK: undefined,
      similarityThreshold: undefined,
      documentIds: undefined,
    });
  });

  it("parses explicit task and retrieval controls", () => {
    expect(
      parseRetrievalRequest({
        query: "Compare plans",
        knowledge_base_id: DEFAULT_KNOWLEDGE_BASE_ID,
        task_type: "compare",
        top_k: 6,
        similarity_threshold: 0.5,
        document_ids: [DOCUMENT_ID],
      }),
    ).toMatchObject({
      requestedTaskType: "compare",
      topK: 6,
      similarityThreshold: 0.5,
      documentIds: [DOCUMENT_ID],
    });
  });

  it("rejects malformed or unexpected request fields", () => {
    expect(() =>
      parseRetrievalRequest({
        query: "valid",
        top_k: 0,
        unexpected: true,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST", httpStatus: 400 }),
    );
  });

  it("serializes Top-K evidence locators, task understanding, and bounded context", () => {
    const body = retrievalResultToHttp(engineResult(), TRACE_ID);

    expect(body).toMatchObject({
      task_understanding: {
        task_type: "analysis",
        normalized_query: "Why is activation declining?",
      },
      retrieval: {
        result_count: 1,
        query_embedding: {
          model: "text-embedding-3-small",
          dimension: EMBEDDING_DIMENSION,
        },
        chunks: [
          {
            chunk_id: CHUNK_ID,
            document_id: DOCUMENT_ID,
            similarity_score: 0.91,
            metadata: { evidence: { sourceDocumentId: DOCUMENT_ID } },
            locator: {
              page_start: 2,
              line_start: 8,
              start_char: 120,
              section_path: "Activation > Friction",
              source_segments: [
                expect.objectContaining({ source_block_id: "block-4" }),
              ],
            },
          },
        ],
      },
      context: {
        chunks: [
          {
            citation_label: "[S1]",
            chunk_id: CHUNK_ID,
            document_id: DOCUMENT_ID,
          },
        ],
        stats: { received: 1, selected: 1 },
      },
      trace_id: TRACE_ID,
    });
  });

  it("returns typed retrieval errors with a trace header", async () => {
    const response = retrievalErrorResponse(
      new RetrievalError("Invalid query", "INVALID_REQUEST", 400),
      TRACE_ID,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-trace-id")).toBe(TRACE_ID);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid query",
        trace_id: TRACE_ID,
      },
    });
  });

  it("does not expose unexpected infrastructure errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = retrievalErrorResponse(
      new Error("secret database detail"),
      TRACE_ID,
    );

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.not.toContain("secret database detail");
  });
});
