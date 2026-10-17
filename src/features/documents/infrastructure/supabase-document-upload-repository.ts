import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DocumentStatus } from "@/domain";
import {
  DocumentRepositoryError,
  type DocumentUploadRecord,
  type DocumentUploadRepository,
  type UploadingDocumentRecord,
} from "@/features/documents/application/document-upload-repository";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin-client";

interface DocumentRow {
  id: string;
  knowledge_base_id: string;
  display_name: string;
  original_filename: string;
  mime_type: string;
  file_extension: string;
  storage_bucket: string;
  storage_path: string;
  file_size_bytes: number | string;
  sha256: string;
  version_no: number;
  status: DocumentStatus;
  uploaded_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const DOCUMENT_UPLOAD_COLUMNS = [
  "id",
  "knowledge_base_id",
  "display_name",
  "original_filename",
  "mime_type",
  "file_extension",
  "storage_bucket",
  "storage_path",
  "file_size_bytes",
  "sha256",
  "version_no",
  "status",
  "uploaded_at",
  "error_code",
  "error_message",
  "created_at",
  "updated_at",
].join(",");

function toDocumentUploadRecord(row: DocumentRow): DocumentUploadRecord {
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
    sha256: row.sha256,
    versionNo: row.version_no,
    status: row.status,
    uploadedAt: row.uploaded_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function repositoryWriteError(error: unknown): DocumentRepositoryError {
  const postgresCode =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;

  if (postgresCode === "23505") {
    return new DocumentRepositoryError(
      "A document with the same checksum already exists.",
      "DUPLICATE_DOCUMENT",
      { cause: error },
    );
  }

  return new DocumentRepositoryError(
    "The document record could not be written.",
    "DOCUMENT_WRITE_FAILED",
    { cause: error },
  );
}

export class SupabaseDocumentUploadRepository implements DocumentUploadRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseAdminClient()) {}

  async createUploading(record: UploadingDocumentRecord): Promise<DocumentUploadRecord> {
    const { data, error } = await this.client
      .from("documents")
      .insert({
        id: record.id,
        knowledge_base_id: record.knowledgeBaseId,
        display_name: record.displayName,
        original_filename: record.originalFilename,
        mime_type: record.mimeType,
        file_extension: record.fileExtension,
        storage_bucket: record.storageBucket,
        storage_path: record.storagePath,
        file_size_bytes: record.fileSizeBytes,
        sha256: record.sha256,
        version_no: record.versionNo,
        status: "uploading",
        processing_stage: "upload",
        progress_pct: 0,
      })
      .select(DOCUMENT_UPLOAD_COLUMNS)
      .single();

    if (error || !data) {
      throw repositoryWriteError(error);
    }

    return toDocumentUploadRecord(data as unknown as DocumentRow);
  }

  async findById(id: string): Promise<DocumentUploadRecord | null> {
    const { data, error } = await this.client
      .from("documents")
      .select(DOCUMENT_UPLOAD_COLUMNS)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new DocumentRepositoryError(
        "The document record could not be read.",
        "DOCUMENT_WRITE_FAILED",
        { cause: error },
      );
    }

    return data ? toDocumentUploadRecord(data as unknown as DocumentRow) : null;
  }

  async markUploaded(id: string, uploadedAt: string): Promise<DocumentUploadRecord> {
    const { data, error } = await this.client
      .from("documents")
      .update({
        status: "uploaded",
        processing_stage: null,
        progress_pct: 100,
        uploaded_at: uploadedAt,
        error_code: null,
        error_message: null,
      })
      .eq("id", id)
      .eq("status", "uploading")
      .select(DOCUMENT_UPLOAD_COLUMNS)
      .maybeSingle();

    if (error) {
      throw repositoryWriteError(error);
    }

    if (!data) {
      const current = await this.findById(id);

      if (current && ["uploaded", "processing", "ready"].includes(current.status)) {
        return current;
      }

      throw new DocumentRepositoryError(
        "The document no longer exists or changed state.",
        current ? "DOCUMENT_WRITE_FAILED" : "DOCUMENT_NOT_FOUND",
      );
    }

    return toDocumentUploadRecord(data as unknown as DocumentRow);
  }

  async markFailed(id: string, errorCode: string, errorMessage: string): Promise<void> {
    const { error } = await this.client
      .from("documents")
      .update({
        status: "failed",
        processing_stage: errorCode === "DOCUMENT_DELETE_FAILED" ? null : "upload",
        error_code: errorCode,
        error_message: errorMessage,
      })
      .eq("id", id)
      .in("status", ["uploading", "uploaded", "deleting"]);

    if (error) {
      throw repositoryWriteError(error);
    }
  }

  async markDeleting(id: string): Promise<DocumentUploadRecord> {
    const { data, error } = await this.client
      .from("documents")
      .update({ status: "deleting", processing_stage: null, error_code: null, error_message: null })
      .eq("id", id)
      .is("deleted_at", null)
      .select(DOCUMENT_UPLOAD_COLUMNS)
      .maybeSingle();

    if (error) throw repositoryWriteError(error);
    if (!data) throw new DocumentRepositoryError("The document was not found.", "DOCUMENT_NOT_FOUND");
    return toDocumentUploadRecord(data as unknown as DocumentRow);
  }

  async markDeleted(id: string, deletedAt: string): Promise<void> {
    const { data, error } = await this.client
      .from("documents")
      .update({ status: "deleted", deleted_at: deletedAt })
      .eq("id", id)
      .eq("status", "deleting")
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();

    if (error) throw repositoryWriteError(error);
    if (!data) {
      const { data } = await this.client.from("documents").select("id").eq("id", id).eq("status", "deleted").maybeSingle();
      if (!data) throw new DocumentRepositoryError("The document could not be marked deleted.", "DOCUMENT_WRITE_FAILED");
    }
  }
}
