import { randomUUID } from "node:crypto";

import { z } from "zod";

import { DocumentUploadError } from "@/features/documents/application/document-upload-error";
import type { DocumentUploadRecord } from "@/features/documents/application/document-upload-repository";

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    trace_id: string;
  };
}

const initializeDocumentUploadSchema = z
  .object({
    display_name: z.string().optional(),
    knowledge_base_id: z.string().optional(),
    filename: z.string(),
    mime_type: z.string(),
    size_bytes: z.number(),
    sha256: z.string(),
  })
  .strict();

export function createTraceId(): string {
  return randomUUID();
}

export function documentToHttp(document: DocumentUploadRecord) {
  return {
    id: document.id,
    knowledge_base_id: document.knowledgeBaseId,
    display_name: document.displayName,
    original_filename: document.originalFilename,
    mime_type: document.mimeType,
    file_extension: document.fileExtension,
    file_size_bytes: document.fileSizeBytes,
    sha256: document.sha256,
    version_no: document.versionNo,
    status: document.status,
    uploaded_at: document.uploadedAt,
    error_code: document.errorCode,
    error_message: document.errorMessage,
    created_at: document.createdAt,
    updated_at: document.updatedAt,
  };
}

export function errorResponse(error: unknown, traceId: string): Response {
  if (error instanceof DocumentUploadError) {
    const body: ErrorResponseBody = {
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

  console.error("Unhandled document upload error", { traceId, error });

  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The document upload request could not be completed.",
        trace_id: traceId,
      },
    } satisfies ErrorResponseBody,
    { status: 500, headers: { "x-trace-id": traceId } },
  );
}

export function parseInitializeRequest(value: unknown): {
  displayName?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  knowledgeBaseId?: string;
} {
  const parsed = initializeDocumentUploadSchema.safeParse(value);

  if (!parsed.success) {
    throw new DocumentUploadError(
      "filename, mime_type, size_bytes, and sha256 are required.",
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

  const body = parsed.data;

  return {
    filename: body.filename,
    mimeType: body.mime_type,
    sizeBytes: body.size_bytes,
    sha256: body.sha256,
    ...(body.display_name !== undefined ? { displayName: body.display_name } : {}),
    ...(body.knowledge_base_id !== undefined
      ? { knowledgeBaseId: body.knowledge_base_id }
      : {}),
  };
}
