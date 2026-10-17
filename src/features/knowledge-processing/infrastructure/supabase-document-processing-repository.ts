import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DocumentProcessingJob,
  DocumentProcessingStage,
  DocumentStatus,
  JsonObject,
  ProcessingJobStatus,
} from "@/domain";
import {
  DocumentProcessingRepositoryError,
  type CompleteProcessingJobInput,
  type CreateProcessingJobInput,
  type DocumentProcessingRepository,
  type FailProcessingJobInput,
  type ProcessingDocumentRecord,
} from "@/features/knowledge-processing/application/document-processing-repository";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin-client";

interface ProcessingDocumentRow {
  id: string;
  knowledge_base_id: string;
  display_name: string;
  original_filename: string;
  mime_type: string;
  file_extension: string;
  storage_bucket: string;
  storage_path: string;
  file_size_bytes: number | string;
  status: DocumentStatus;
  processing_stage: DocumentProcessingStage | null;
  progress_pct: number;
  metadata: JsonObject;
  parser_name: string | null;
  parser_version: string | null;
  page_count: number | null;
  char_count: number | null;
  token_count: number | null;
  chunk_count: number;
  error_code: string | null;
  error_message: string | null;
  uploaded_at: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ProcessingJobRow {
  id: string;
  document_id: string;
  stage: DocumentProcessingStage;
  status: ProcessingJobStatus;
  attempt: number;
  max_attempts: number;
  progress_pct: number;
  idempotency_key: string | null;
  config: JsonObject;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

const PROCESSING_DOCUMENT_COLUMNS = [
  "id",
  "knowledge_base_id",
  "display_name",
  "original_filename",
  "mime_type",
  "file_extension",
  "storage_bucket",
  "storage_path",
  "file_size_bytes",
  "status",
  "processing_stage",
  "progress_pct",
  "metadata",
  "parser_name",
  "parser_version",
  "page_count",
  "char_count",
  "token_count",
  "chunk_count",
  "error_code",
  "error_message",
  "uploaded_at",
  "processed_at",
  "created_at",
  "updated_at",
].join(",");

const PROCESSING_JOB_COLUMNS = [
  "id",
  "document_id",
  "stage",
  "status",
  "attempt",
  "max_attempts",
  "progress_pct",
  "idempotency_key",
  "config",
  "error_code",
  "error_message",
  "started_at",
  "finished_at",
  "created_at",
  "updated_at",
].join(",");

function toDocument(row: ProcessingDocumentRow): ProcessingDocumentRecord {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    displayName: row.display_name,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileExtension: row.file_extension,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    fileSizeBytes: Number(row.file_size_bytes),
    status: row.status,
    processingStage: row.processing_stage,
    progressPct: row.progress_pct,
    metadata: row.metadata,
    parserName: row.parser_name,
    parserVersion: row.parser_version,
    pageCount: row.page_count,
    charCount: row.char_count,
    tokenCount: row.token_count,
    chunkCount: row.chunk_count,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    uploadedAt: row.uploaded_at,
    processedAt: row.processed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toJob(row: ProcessingJobRow): DocumentProcessingJob {
  return {
    id: row.id,
    documentId: row.document_id,
    stage: row.stage,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    progressPct: row.progress_pct,
    idempotencyKey: row.idempotency_key,
    config: row.config,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function repositoryError(
  message: string,
  error: unknown,
): DocumentProcessingRepositoryError {
  const code = postgresCode(error);

  if (code === "P0002") {
    return new DocumentProcessingRepositoryError(message, "JOB_NOT_FOUND", { cause: error });
  }

  if (code === "23514") {
    return new DocumentProcessingRepositoryError(message, "INVALID_JOB_STATE", {
      cause: error,
    });
  }

  if (code === "23505") {
    return new DocumentProcessingRepositoryError(message, "DUPLICATE_ACTIVE_JOB", {
      cause: error,
    });
  }

  return new DocumentProcessingRepositoryError(message, "WRITE_FAILED", { cause: error });
}

export class SupabaseDocumentProcessingRepository
  implements DocumentProcessingRepository
{
  constructor(private readonly client: SupabaseClient = getSupabaseAdminClient()) {}

  async findDocument(documentId: string): Promise<ProcessingDocumentRecord | null> {
    const { data, error } = await this.client
      .from("documents")
      .select(PROCESSING_DOCUMENT_COLUMNS)
      .eq("id", documentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw repositoryError("The source document could not be read.", error);
    }

    return data ? toDocument(data as unknown as ProcessingDocumentRow) : null;
  }

  async findJob(jobId: string): Promise<DocumentProcessingJob | null> {
    const { data, error } = await this.client
      .from("document_processing_jobs")
      .select(PROCESSING_JOB_COLUMNS)
      .eq("id", jobId)
      .maybeSingle();

    if (error) {
      throw repositoryError("The processing job could not be read.", error);
    }

    return data ? toJob(data as unknown as ProcessingJobRow) : null;
  }

  async findActiveJobForDocument(documentId: string): Promise<DocumentProcessingJob | null> {
    const { data, error } = await this.client
      .from("document_processing_jobs")
      .select(PROCESSING_JOB_COLUMNS)
      .eq("document_id", documentId)
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw repositoryError("The active processing job could not be read.", error);
    }

    return data ? toJob(data as unknown as ProcessingJobRow) : null;
  }

  async findLatestJobForDocument(documentId: string): Promise<DocumentProcessingJob | null> {
    const { data, error } = await this.client
      .from("document_processing_jobs")
      .select(PROCESSING_JOB_COLUMNS)
      .eq("document_id", documentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw repositoryError("The latest processing job could not be read.", error);
    }

    return data ? toJob(data as unknown as ProcessingJobRow) : null;
  }

  async createPendingJob(input: CreateProcessingJobInput): Promise<DocumentProcessingJob> {
    const { data, error } = await this.client
      .from("document_processing_jobs")
      .insert({
        document_id: input.documentId,
        stage: "parse",
        status: "pending",
        attempt: 1,
        max_attempts: input.maxAttempts,
        progress_pct: 0,
        idempotency_key: input.idempotencyKey,
        config: input.config,
      })
      .select(PROCESSING_JOB_COLUMNS)
      .single();

    if (error || !data) {
      if (postgresCode(error) === "23505") {
        const active = await this.findActiveJobForDocument(input.documentId);

        if (active) {
          return active;
        }
      }

      throw repositoryError("The processing job could not be created.", error);
    }

    return toJob(data as unknown as ProcessingJobRow);
  }

  async claimJob(jobId: string, startedAt: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("claim_document_processing_job", {
      p_job_id: jobId,
      p_started_at: startedAt,
    });

    if (error) {
      throw repositoryError("The processing job could not be claimed.", error);
    }

    return data === true;
  }

  async updateProgress(
    jobId: string,
    stage: DocumentProcessingStage,
    progressPct: number,
  ): Promise<void> {
    const job = await this.findJob(jobId);

    if (!job) {
      throw new DocumentProcessingRepositoryError(
        "The processing job was not found.",
        "JOB_NOT_FOUND",
      );
    }

    const { data: updatedJob, error: jobError } = await this.client
      .from("document_processing_jobs")
      .update({ stage, progress_pct: progressPct })
      .eq("id", jobId)
      .eq("status", "processing")
      .select("id")
      .maybeSingle();

    if (jobError || !updatedJob) {
      throw repositoryError("The processing job progress could not be updated.", jobError);
    }

    const { data: updatedDocument, error: documentError } = await this.client
      .from("documents")
      .update({ processing_stage: stage, progress_pct: progressPct })
      .eq("id", job.documentId)
      .eq("status", "processing")
      .select("id")
      .maybeSingle();

    if (documentError || !updatedDocument) {
      throw repositoryError("The document progress could not be updated.", documentError);
    }
  }

  async completeJob(input: CompleteProcessingJobInput): Promise<void> {
    const { error } = await this.client.rpc("finalize_document_processing_job", {
      p_job_id: input.jobId,
      p_parser_name: input.parserName,
      p_parser_version: input.parserVersion,
      p_page_count: input.pageCount,
      p_char_count: input.charCount,
      p_token_count: input.tokenCount,
      p_processing_metadata: input.processingMetadata,
      p_chunks: input.chunks.map((chunk) => ({
        chunk_index: chunk.chunkIndex,
        text: chunk.text,
        text_hash: chunk.textHash,
        token_count: chunk.tokenCount,
        page_start: chunk.pageStart,
        page_end: chunk.pageEnd,
        start_char: chunk.startChar,
        end_char: chunk.endChar,
        section_path: chunk.sectionPath,
        metadata: chunk.metadata,
        embedding: Array.from(chunk.embedding),
        embedding_provider: chunk.embeddingProvider,
        embedding_model: chunk.embeddingModel,
        embedding_model_version: chunk.embeddingModelVersion,
        embedding_dimension: chunk.embeddingDimension,
        embedded_at: chunk.embeddedAt,
      })),
      p_completed_at: input.completedAt,
    });

    if (error) {
      throw repositoryError("The processed document could not be finalized.", error);
    }
  }

  async failJob(input: FailProcessingJobInput): Promise<void> {
    const { error } = await this.client.rpc("fail_document_processing_job", {
      p_job_id: input.jobId,
      p_error_code: input.errorCode,
      p_error_message: input.errorMessage,
      p_failed_at: input.failedAt,
    });

    if (error) {
      throw repositoryError("The processing failure could not be recorded.", error);
    }
  }

  async markRetry(jobId: string): Promise<DocumentProcessingJob> {
    const current = await this.findJob(jobId);

    if (!current) {
      throw new DocumentProcessingRepositoryError(
        "The processing job was not found.",
        "JOB_NOT_FOUND",
      );
    }

    if (current.status !== "failed") {
      throw new DocumentProcessingRepositoryError(
        "Only failed processing jobs can be retried.",
        "INVALID_JOB_STATE",
      );
    }

    if (current.attempt >= current.maxAttempts) {
      throw new DocumentProcessingRepositoryError(
        "The processing job has reached its retry limit.",
        "MAX_ATTEMPTS_REACHED",
      );
    }

    const { data, error } = await this.client
      .from("document_processing_jobs")
      .update({ status: "retry" })
      .eq("id", jobId)
      .eq("status", "failed")
      .select(PROCESSING_JOB_COLUMNS)
      .maybeSingle();

    if (error || !data) {
      throw repositoryError("The processing job could not enter retry.", error);
    }

    return toJob(data as unknown as ProcessingJobRow);
  }

  async requeueRetry(jobId: string): Promise<DocumentProcessingJob> {
    const current = await this.findJob(jobId);

    if (!current) {
      throw new DocumentProcessingRepositoryError(
        "The processing job was not found.",
        "JOB_NOT_FOUND",
      );
    }

    if (current.status !== "retry") {
      throw new DocumentProcessingRepositoryError(
        "The processing job is not waiting to be requeued.",
        "INVALID_JOB_STATE",
      );
    }

    if (current.attempt >= current.maxAttempts) {
      throw new DocumentProcessingRepositoryError(
        "The processing job has reached its retry limit.",
        "MAX_ATTEMPTS_REACHED",
      );
    }

    const { data, error } = await this.client
      .from("document_processing_jobs")
      .update({
        status: "pending",
        stage: "parse",
        attempt: current.attempt + 1,
        progress_pct: 0,
        error_code: null,
        error_message: null,
        started_at: null,
        finished_at: null,
      })
      .eq("id", jobId)
      .eq("status", "retry")
      .select(PROCESSING_JOB_COLUMNS)
      .maybeSingle();

    if (error || !data) {
      throw repositoryError("The processing job could not be requeued.", error);
    }

    return toJob(data as unknown as ProcessingJobRow);
  }
}
