import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { JsonObject, QaRunStatus } from "@/domain";
import {
  QaRunRepositoryError,
  type PersistQaRunInput,
  type QaRunRepository,
  type StartedQaRun,
  type StartQaRunInput,
} from "@/features/qa/application/qa-run-repository";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin-client";

interface StartQaRunRow {
  qa_run_id: string;
  conversation_id: string;
  user_message_id: string;
}

interface CompleteQaRunRow {
  assistant_message_id: string;
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) {
    return (data[0] as T | undefined) ?? null;
  }

  return data && typeof data === "object" ? (data as T) : null;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function repositoryError(
  message: string,
  code: QaRunRepositoryError["code"],
  error: unknown,
): QaRunRepositoryError {
  return new QaRunRepositoryError(
    errorCode(error) ? `${message} (${errorCode(error)})` : message,
    code,
    { cause: error },
  );
}

function locatorSnapshot(
  chunk: PersistQaRunInput["retrievedChunks"][number],
  citationLabel: string | null,
): JsonObject {
  return {
    page_start: chunk.locator.pageStart,
    page_end: chunk.locator.pageEnd,
    line_start: chunk.locator.lineStart,
    line_end: chunk.locator.lineEnd,
    start_char: chunk.locator.startChar,
    end_char: chunk.locator.endChar,
    section_path: chunk.locator.sectionPath,
    source_segments: chunk.locator.sourceSegments.map((segment) => ({
      source_block_id: segment.sourceBlockId,
      page_start: segment.pageStart,
      page_end: segment.pageEnd,
      line_start: segment.lineStart,
      line_end: segment.lineEnd,
      start_char: segment.startChar,
      end_char: segment.endChar,
    })),
    citation_label: citationLabel,
    document_version: chunk.documentVersion,
    embedding: {
      provider: chunk.embedding.provider,
      model: chunk.embedding.model,
      model_version: chunk.embedding.modelVersion,
      dimension: chunk.embedding.dimension,
      embedded_at: chunk.embedding.embeddedAt,
    },
  };
}

function answerPayload(input: PersistQaRunInput): JsonObject {
  return {
    answer: input.answer.answer,
    claims: input.answer.claims.map((claim) => ({
      claim_text: claim.claimText,
      claim_type: claim.claimType,
      weight: claim.weight,
      evidence: claim.evidence.map((evidence) => ({
        citation_label: evidence.citationLabel,
        quote: evidence.quote,
      })),
    })),
    limitations: [...input.answer.limitations],
    insufficient_evidence: input.status === "insufficient_evidence",
  };
}

function metricsPayload(input: PersistQaRunInput): JsonObject {
  const toMetric = (metric: PersistQaRunInput["quality"]["retrievalScore"]): JsonObject => ({
    score: metric.score,
    explanation: metric.explanation,
    details: metric.details,
  });

  return {
    retrieval_score: toMetric(input.quality.retrievalScore),
    evidence_coverage: toMetric(input.quality.evidenceCoverage),
    knowledge_match: toMetric(input.quality.knowledgeMatch),
    confidence: toMetric(input.quality.confidence),
    evaluator_details: input.quality.details,
    verification_details: input.verification.details,
    operations: {
      query_embedding_tokens: input.queryEmbeddingTokens ?? null,
      generation_input_tokens: input.inputTokens,
      generation_output_tokens: input.outputTokens,
      latency_ms: input.latencyMs,
      estimated_cost_usd: input.estimatedCostUsd ?? null,
      pricing_source: input.pricingSource ?? null,
      rates_usd_per_million_tokens: {
        embedding_input: input.ratesUsdPerMillionTokens?.embeddingInput ?? null,
        language_input: input.ratesUsdPerMillionTokens?.languageInput ?? null,
        language_output: input.ratesUsdPerMillionTokens?.languageOutput ?? null,
      },
    },
  };
}

export class SupabaseQaRunRepository implements QaRunRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseAdminClient()) {}

  async start(input: StartQaRunInput): Promise<StartedQaRun> {
    const { data, error } = await this.client.rpc("start_qa_run", {
      p_knowledge_base_id: input.knowledgeBaseId,
      p_query: input.query,
      p_requested_task_type: input.requestedTaskType,
      p_conversation_id: input.conversationId ?? null,
    });

    const row = firstRow<StartQaRunRow>(data);

    if (error || !row?.qa_run_id || !row.conversation_id || !row.user_message_id) {
      throw repositoryError("The QA run could not be started.", "START_FAILED", error);
    }

    return {
      qaRunId: row.qa_run_id,
      conversationId: row.conversation_id,
      userMessageId: row.user_message_id,
    };
  }

  async setStatus(qaRunId: string, status: QaRunStatus): Promise<void> {
    const { error } = await this.client.rpc("set_qa_run_status", {
      p_qa_run_id: qaRunId,
      p_status: status,
    });

    if (error) {
      throw repositoryError(
        "The QA run status could not be updated.",
        "STATUS_UPDATE_FAILED",
        error,
      );
    }
  }

  async complete(input: PersistQaRunInput): Promise<{ assistantMessageId: string }> {
    const selectedIds = new Set(input.selectedChunkIds);
    const citationByChunk = new Map<string, string>();

    for (const claim of input.claims) {
      for (const evidence of claim.evidence) {
        citationByChunk.set(evidence.chunkId, evidence.citationLabel);
      }
    }

    const retrievalRows = input.retrievedChunks.map((chunk) => ({
      chunk_id: chunk.chunkId,
      document_id: chunk.documentId,
      rank: chunk.rank,
      distance: chunk.distance,
      relevance_score: Math.round(chunk.similarityScore * 10_000) / 100,
      selected: selectedIds.has(chunk.chunkId),
      document_name_snapshot: chunk.documentName,
      chunk_text_snapshot: chunk.text,
      locator_snapshot: locatorSnapshot(
        chunk,
        citationByChunk.get(chunk.chunkId) ?? null,
      ),
    }));
    const claimRows = input.claims.map((claim) => ({
      claim_index: claim.claimIndex,
      claim_text: claim.claimText,
      claim_type: claim.claimType,
      weight: claim.weight,
      support_status: claim.supportStatus,
    }));
    const evidenceRows = input.claims.flatMap((claim) =>
      claim.evidence.map((evidence) => ({
        claim_index: claim.claimIndex,
        citation_label: evidence.citationLabel,
        quote_text: evidence.quoteText,
        chunk_id: evidence.chunkId,
        document_id: evidence.documentId,
        locator: evidence.locator,
        support_score: evidence.supportScore,
        document_name_snapshot: evidence.documentName,
        document_version_snapshot: evidence.documentVersion,
      })),
    );
    const { data, error } = await this.client.rpc("complete_qa_run", {
      p_qa_run_id: input.run.qaRunId,
      p_requested_task_type: input.requestedTaskType,
      p_classified_task_type: input.classifiedTaskType,
      p_classifier_confidence: input.classifierConfidence,
      p_task_understanding_details: input.taskUnderstandingDetails,
      p_retrieval_config: input.retrievalConfig,
      p_answer_payload: answerPayload(input),
      p_retrieval_rows: retrievalRows,
      p_claim_rows: claimRows,
      p_evidence_rows: evidenceRows,
      p_metrics: metricsPayload(input),
      p_status: input.status,
      p_model: input.model,
      p_prompt_version: input.promptVersion,
      p_input_tokens: input.inputTokens,
      p_output_tokens: input.outputTokens,
      p_latency_ms: input.latencyMs,
      p_insufficient_reason: input.insufficientReason,
    });
    const row = firstRow<CompleteQaRunRow>(data);

    if (error || !row?.assistant_message_id) {
      throw repositoryError(
        "The complete QA trace could not be persisted.",
        "COMPLETE_FAILED",
        error,
      );
    }

    return { assistantMessageId: row.assistant_message_id };
  }

  async fail(input: {
    qaRunId: string;
    userMessageId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    const { error } = await this.client.rpc("fail_qa_run", {
      p_qa_run_id: input.qaRunId,
      p_user_message_id: input.userMessageId,
      p_error_code: input.errorCode,
      p_error_message: input.errorMessage,
    });

    if (error) {
      throw repositoryError(
        "The QA failure state could not be persisted.",
        "FAILURE_UPDATE_FAILED",
        error,
      );
    }
  }
}
