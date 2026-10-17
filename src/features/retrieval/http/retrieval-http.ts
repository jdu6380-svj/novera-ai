import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  DEFAULT_KNOWLEDGE_BASE_ID,
  TASK_TYPES,
} from "@/domain";
import type { RetrievalEngineResult } from "@/features/retrieval/application/retrieval-engine";
import { RetrievalError } from "@/features/retrieval/application/retrieval-error";
import type {
  RetrievedChunk,
  RetrievalLocator,
} from "@/features/retrieval/domain/retrieval";

export interface RetrievalErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    trace_id: string;
  };
}

const retrievalRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(4_000),
    knowledge_base_id: z.uuid().default(DEFAULT_KNOWLEDGE_BASE_ID),
    task_type: z.enum(TASK_TYPES).default("auto"),
    top_k: z.number().int().min(1).max(50).optional(),
    similarity_threshold: z.number().min(0).max(1).optional(),
    document_ids: z.array(z.uuid()).max(50).optional(),
  })
  .strict();

export function createRetrievalTraceId(): string {
  return randomUUID();
}

export function parseRetrievalRequest(value: unknown) {
  const parsed = retrievalRequestSchema.safeParse(value);

  if (!parsed.success) {
    throw new RetrievalError(
      "query is required and retrieval controls must use valid values.",
      "INVALID_REQUEST",
      400,
      {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  }

  return {
    query: parsed.data.query,
    knowledgeBaseId: parsed.data.knowledge_base_id,
    requestedTaskType: parsed.data.task_type,
    topK: parsed.data.top_k,
    similarityThreshold: parsed.data.similarity_threshold,
    documentIds: parsed.data.document_ids,
  };
}

function locatorToHttp(locator: RetrievalLocator) {
  return {
    page_start: locator.pageStart,
    page_end: locator.pageEnd,
    line_start: locator.lineStart,
    line_end: locator.lineEnd,
    start_char: locator.startChar,
    end_char: locator.endChar,
    section_path: locator.sectionPath,
    source_segments: locator.sourceSegments.map((segment) => ({
      source_block_id: segment.sourceBlockId,
      page_start: segment.pageStart,
      page_end: segment.pageEnd,
      line_start: segment.lineStart,
      line_end: segment.lineEnd,
      start_char: segment.startChar,
      end_char: segment.endChar,
    })),
  };
}

function retrievedChunkToHttp(chunk: RetrievedChunk) {
  return {
    rank: chunk.rank,
    chunk_id: chunk.chunkId,
    document_id: chunk.documentId,
    document_name: chunk.documentName,
    document_version: chunk.documentVersion,
    document_mime_type: chunk.documentMimeType,
    chunk_index: chunk.chunkIndex,
    text: chunk.text,
    token_count: chunk.tokenCount,
    similarity_score: chunk.similarityScore,
    distance: chunk.distance,
    metadata: chunk.metadata,
    document_metadata: chunk.documentMetadata,
    locator: locatorToHttp(chunk.locator),
    embedding: {
      provider: chunk.embedding.provider,
      model: chunk.embedding.model,
      model_version: chunk.embedding.modelVersion,
      dimension: chunk.embedding.dimension,
      embedded_at: chunk.embedding.embeddedAt,
    },
  };
}

export function retrievalResultToHttp(
  result: RetrievalEngineResult,
  traceId: string,
) {
  return {
    query: result.query,
    task_understanding: {
      requested_task_type: result.taskUnderstanding.requestedTaskType,
      task_type: result.taskUnderstanding.understoodTaskType,
      confidence: result.taskUnderstanding.confidence,
      normalized_query: result.taskUnderstanding.normalizedQuery,
      signals: result.taskUnderstanding.signals.map((signal) => ({
        id: signal.id,
        task_type: signal.taskType,
        matched_text: signal.matchedText,
        weight: signal.weight,
      })),
      details: result.taskUnderstanding.details,
    },
    retrieval: {
      requested_top_k: result.retrieval.topK,
      similarity_threshold: result.retrieval.similarityThreshold,
      result_count: result.retrieval.chunks.length,
      query_embedding: {
        provider: result.retrieval.embedding.provider,
        model: result.retrieval.embedding.model,
        model_version: result.retrieval.embedding.modelVersion,
        dimension: result.retrieval.embedding.dimensions,
        embedded_at: result.retrieval.embedding.embeddedAt,
        usage_tokens: result.retrieval.embedding.usageTokens,
      },
      chunks: result.retrieval.chunks.map(retrievedChunkToHttp),
    },
    context: {
      text: result.context.context,
      chunks: result.context.chunks.map((chunk) => ({
        rank: chunk.rank,
        citation_label: chunk.citationLabel,
        chunk_id: chunk.chunkId,
        document_id: chunk.documentId,
        document_name: chunk.documentName,
        similarity_score: chunk.similarityScore,
        metadata: chunk.metadata,
        locator: {
          page_start: chunk.locator.pageStart ?? null,
          page_end: chunk.locator.pageEnd ?? null,
          line_start: chunk.locator.lineStart ?? null,
          line_end: chunk.locator.lineEnd ?? null,
          start_char: chunk.locator.startChar ?? null,
          end_char: chunk.locator.endChar ?? null,
          section_path: chunk.locator.sectionPath ?? null,
        },
        context_text: chunk.contextText,
        estimated_context_tokens: chunk.estimatedContextTokens,
        truncated: chunk.truncated,
      })),
      stats: {
        received: result.context.stats.received,
        selected: result.context.stats.selected,
        estimated_tokens: result.context.stats.estimatedTokens,
        characters: result.context.stats.characters,
        truncated: result.context.stats.truncated,
        dropped: {
          invalid: result.context.stats.dropped.invalid,
          below_threshold: result.context.stats.dropped.belowThreshold,
          duplicate: result.context.stats.dropped.duplicate,
          per_document_limit: result.context.stats.dropped.perDocumentLimit,
          max_chunks: result.context.stats.dropped.maxChunks,
          budget: result.context.stats.dropped.budget,
        },
      },
      config: {
        minimum_similarity: result.context.config.minimumSimilarity,
        max_chunks: result.context.config.maxChunks,
        max_chunks_per_document: result.context.config.maxChunksPerDocument,
        max_tokens: result.context.config.maxTokens,
        max_characters: result.context.config.maxCharacters,
      },
    },
    trace_id: traceId,
  };
}

export function retrievalErrorResponse(error: unknown, traceId: string): Response {
  if (error instanceof RetrievalError) {
    const body: RetrievalErrorResponseBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        trace_id: traceId,
      },
    };

    return Response.json(body, {
      status: error.httpStatus,
      headers: { "x-trace-id": traceId },
    });
  }

  console.error("Unhandled retrieval error", { traceId, error });

  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The knowledge retrieval request could not be completed.",
        trace_id: traceId,
      },
    } satisfies RetrievalErrorResponseBody,
    { status: 500, headers: { "x-trace-id": traceId } },
  );
}
