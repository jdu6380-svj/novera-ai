import { randomUUID } from "node:crypto";

import { DocumentProcessingError } from "@/features/knowledge-processing/application/document-processing-error";
import type { ProcessingDocumentRecord } from "@/features/knowledge-processing/application/document-processing-repository";
import type { DocumentProcessingJob } from "@/domain";

export interface ProcessingErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    trace_id: string;
  };
}

export function createProcessingTraceId(): string {
  return randomUUID();
}

export function processingDocumentToHttp(document: ProcessingDocumentRecord) {
  return {
    id: document.id,
    knowledge_base_id: document.knowledgeBaseId,
    display_name: document.displayName,
    original_filename: document.originalFilename,
    mime_type: document.mimeType,
    file_extension: document.fileExtension,
    storage_bucket: document.storageBucket,
    storage_path: document.storagePath,
    file_size_bytes: document.fileSizeBytes,
    status: document.status,
    processing_stage: document.processingStage,
    progress_pct: document.progressPct,
    parser_name: document.parserName,
    parser_version: document.parserVersion,
    page_count: document.pageCount,
    char_count: document.charCount,
    token_count: document.tokenCount,
    chunk_count: document.chunkCount,
    metadata: document.metadata,
    error_code: document.errorCode,
    error_message: document.errorMessage,
    uploaded_at: document.uploadedAt,
    processed_at: document.processedAt,
    created_at: document.createdAt,
    updated_at: document.updatedAt,
  };
}

export function processingJobToHttp(job: DocumentProcessingJob) {
  return {
    id: job.id,
    document_id: job.documentId,
    stage: job.stage,
    status: job.status,
    attempt: job.attempt,
    max_attempts: job.maxAttempts,
    progress_pct: job.progressPct,
    idempotency_key: job.idempotencyKey,
    config: job.config,
    error_code: job.errorCode,
    error_message: job.errorMessage,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

export function processingErrorResponse(error: unknown, traceId: string): Response {
  if (error instanceof DocumentProcessingError) {
    const body: ProcessingErrorResponseBody = {
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

  console.error("Unhandled document processing error", { traceId, error });

  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The document processing request could not be completed.",
        trace_id: traceId,
      },
    } satisfies ProcessingErrorResponseBody,
    { status: 500, headers: { "x-trace-id": traceId } },
  );
}
