import { randomUUID } from "node:crypto";

import { z } from "zod";

import { DEFAULT_KNOWLEDGE_BASE_ID, TASK_TYPES } from "@/domain";
import type { QaPipelineResult, QaRunInput } from "@/features/qa/domain/qa";

export interface QaRunErrorResponseBody {
  error: {
    code: string;
    message: string;
    trace_id: string;
    details?: Record<string, unknown>;
  };
}

const qaRunRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(4_000),
    knowledge_base_id: z.uuid().default(DEFAULT_KNOWLEDGE_BASE_ID),
    task_type: z.enum(TASK_TYPES).default("auto"),
    top_k: z.number().int().min(1).max(50).optional(),
    similarity_threshold: z.number().min(0).max(1).optional(),
    document_ids: z.array(z.uuid()).max(50).optional(),
    conversation_id: z.uuid().nullable().optional(),
  })
  .strict();

export class QaRunHttpError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "QaRunHttpError";
  }
}

export function createQaRunTraceId(): string {
  return randomUUID();
}

export function parseQaRunRequest(value: unknown): QaRunInput {
  const parsed = qaRunRequestSchema.safeParse(value);

  if (!parsed.success) {
    throw new QaRunHttpError(
      "query is required and QA controls must use valid values.",
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
    conversationId: parsed.data.conversation_id,
  };
}

function evidenceToHttp(evidence: QaPipelineResult["claims"][number]["evidence"][number]) {
  return {
    citation_label: evidence.citationLabel,
    quote: evidence.quoteText,
    chunk_id: evidence.chunkId,
    document_id: evidence.documentId,
    document_name: evidence.documentName,
    document_version: evidence.documentVersion,
    locator: evidence.locator,
    support_score: evidence.supportScore,
  };
}

export function qaRunResultToHttp(result: QaPipelineResult, traceId: string) {
  return {
    qa_run_id: result.qaRunId,
    conversation_id: result.conversationId,
    user_message_id: result.userMessageId,
    assistant_message_id: result.assistantMessageId,
    query: result.query,
    status: result.status,
    task_understanding: {
      requested_task_type: result.taskUnderstanding.requestedTaskType,
      task_type: result.taskUnderstanding.understoodTaskType,
      confidence: result.taskUnderstanding.confidence,
      details: result.taskUnderstanding.details,
    },
    answer: {
      answer: result.answer.answer,
      limitations: result.answer.limitations,
      insufficient_evidence: result.answer.insufficientEvidence,
      claims: result.claims.map((claim) => ({
        claim_index: claim.claimIndex,
        claim_text: claim.claimText,
        claim_type: claim.claimType,
        weight: claim.weight,
        support_status: claim.supportStatus,
        evidence: claim.evidence.map(evidenceToHttp),
        discarded_evidence: claim.discardedEvidence,
      })),
    },
    sources: result.sources.map((source) => ({
      citation_label: source.citationLabel,
      document_id: source.documentId,
      document_name: source.documentName,
      document_version: source.documentVersion,
      locator: source.locator,
    })),
    quality_scores: {
      retrieval_score: result.quality.retrievalScore,
      evidence_coverage: result.quality.evidenceCoverage,
      knowledge_match: result.quality.knowledgeMatch,
      confidence: result.quality.confidence,
      details: result.quality.details,
    },
    retrieval: {
      result_count: result.retrievedChunks.length,
      selected_count: result.context.chunks.length,
      context_stats: result.context.stats,
    },
    run_stats: {
      model: result.runStats.model,
      prompt_version: result.runStats.promptVersion,
      latency_ms: result.runStats.latencyMs,
      tokens: {
        query_embedding: result.runStats.queryEmbeddingTokens,
        generation_input: result.runStats.generationInputTokens,
        generation_output: result.runStats.generationOutputTokens,
      },
      estimated_cost_usd: result.runStats.estimatedCostUsd,
      pricing_source: result.runStats.pricingSource,
      rates_usd_per_million_tokens: {
        embedding_input: result.runStats.ratesUsdPerMillionTokens.embeddingInput,
        language_input: result.runStats.ratesUsdPerMillionTokens.languageInput,
        language_output: result.runStats.ratesUsdPerMillionTokens.languageOutput,
      },
    },
    trace_id: traceId,
  };
}

export function qaRunErrorResponse(error: unknown, traceId: string): Response {
  if (error instanceof QaRunHttpError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          trace_id: traceId,
          ...(error.details ? { details: error.details } : {}),
        },
      } satisfies QaRunErrorResponseBody,
      { status: error.status, headers: { "x-trace-id": traceId } },
    );
  }

  const errorName = error instanceof Error ? error.name : "INTERNAL_ERROR";
  const message =
    error instanceof Error && /insufficient|evidence/i.test(error.message)
      ? error.message
      : "The evidence-backed QA run could not be completed.";
  const status = /configuration|provider|generation/i.test(errorName) ? 502 : 500;

  console.error("Unhandled QA run error", { traceId, error });

  return Response.json(
    {
      error: {
        code: errorName,
        message,
        trace_id: traceId,
      },
    } satisfies QaRunErrorResponseBody,
    { status, headers: { "x-trace-id": traceId } },
  );
}
