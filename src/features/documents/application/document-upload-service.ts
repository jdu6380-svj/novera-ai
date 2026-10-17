import { randomUUID } from "node:crypto";

import {
  canTransitionDocumentStatus,
  DEFAULT_KNOWLEDGE_BASE_ID,
  type DocumentStatus,
} from "@/domain";
import { DocumentUploadError } from "@/features/documents/application/document-upload-error";
import {
  DocumentRepositoryError,
  type DocumentUploadRecord,
  type DocumentUploadRepository,
} from "@/features/documents/application/document-upload-repository";
import type { StorageAdapter } from "@/infrastructure/storage/storage-adapter";
import {
  getStorageConfig,
  isSupportedDocumentType,
  type StorageConfig,
} from "@/infrastructure/storage/storage-config";
import { StorageError } from "@/infrastructure/storage/storage-error";

const SHA_256_PATTERN = /^[a-f\d]{64}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPLETED_UPLOAD_STATES = new Set<DocumentStatus>(["uploaded", "processing", "ready"]);

export interface InitializeDocumentUploadInput {
  displayName?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  knowledgeBaseId?: string;
}

export interface InitializeDocumentUploadResult {
  document: DocumentUploadRecord;
  upload: {
    bucket: string;
    path: string;
    token: string;
    signedUrl: string;
    expiresAt: string;
  };
}

export interface CompleteDocumentUploadResult {
  document: DocumentUploadRecord;
  idempotent: boolean;
}

export interface DeleteDocumentResult {
  documentId: string;
  deletedAt: string;
  idempotent: boolean;
}

const DOCUMENT_PREVIEW_URL_TTL_SECONDS = 60;

function defaultKnowledgeBaseId(): string {
  return process.env.DEFAULT_KNOWLEDGE_BASE_ID?.trim() || DEFAULT_KNOWLEDGE_BASE_ID;
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function normalizeFilename(filename: string): string {
  const leafName = filename.normalize("NFKC").split(/[\\/]/).pop()?.trim() ?? "";

  if (!leafName || leafName === "." || leafName === "..") {
    throw new DocumentUploadError("A valid file name is required.", "INVALID_FILE_NAME", 400);
  }

  return leafName;
}

function fileExtension(filename: string): string {
  const separator = filename.lastIndexOf(".");
  return separator > 0 ? filename.slice(separator + 1).toLowerCase() : "";
}

function storageSafeFilename(filename: string): string {
  const extension = fileExtension(filename);
  const stem = extension ? filename.slice(0, -(extension.length + 1)) : filename;
  const asciiStem = stem.normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
  const sanitizedStem = asciiStem
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  const sanitized = `${sanitizedStem || "document"}${extension ? `.${extension}` : ""}`;

  if (!sanitized) {
    throw new DocumentUploadError("A valid file name is required.", "INVALID_FILE_NAME", 400);
  }

  return sanitized.slice(0, 180);
}

function inferredDisplayName(filename: string): string {
  const separator = filename.lastIndexOf(".");
  return (separator > 0 ? filename.slice(0, separator) : filename).trim();
}

function validateDocumentId(documentId: string): void {
  if (!UUID_PATTERN.test(documentId)) {
    throw new DocumentUploadError("The document ID is invalid.", "INVALID_REQUEST", 400);
  }
}

function validateInitializeInput(
  input: InitializeDocumentUploadInput,
  config: StorageConfig,
): {
  displayName: string;
  filename: string;
  extension: string;
  mimeType: string;
} {
  const filename = normalizeFilename(input.filename);
  const extension = fileExtension(filename);
  const mimeType = normalizeMimeType(input.mimeType);
  const displayName = (input.displayName?.trim() || inferredDisplayName(filename)).slice(0, 120);

  if (!displayName) {
    throw new DocumentUploadError("A display name is required.", "INVALID_REQUEST", 400);
  }

  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new DocumentUploadError("The document is empty.", "FILE_EMPTY", 400);
  }

  if (input.sizeBytes > config.maxDocumentSizeBytes) {
    throw new DocumentUploadError(
      "The document exceeds the configured upload limit.",
      "FILE_TOO_LARGE",
      413,
      { maxSizeBytes: config.maxDocumentSizeBytes },
    );
  }

  if (!isSupportedDocumentType(extension, mimeType)) {
    throw new DocumentUploadError(
      "The file type is not supported in this phase.",
      "UNSUPPORTED_FILE_TYPE",
      415,
      { allowedExtensions: ["pdf", "md", "txt", "docx"] },
    );
  }

  if (!SHA_256_PATTERN.test(input.sha256)) {
    throw new DocumentUploadError("A valid SHA-256 checksum is required.", "INVALID_CHECKSUM", 400);
  }

  return { displayName, filename, extension, mimeType };
}

function mapRepositoryError(error: unknown): DocumentUploadError {
  if (error instanceof DocumentRepositoryError) {
    if (error.code === "DUPLICATE_DOCUMENT") {
      return new DocumentUploadError(
        "This document already exists in the knowledge base.",
        "DUPLICATE_DOCUMENT",
        409,
        undefined,
        { cause: error },
      );
    }

    if (error.code === "DOCUMENT_NOT_FOUND") {
      return new DocumentUploadError(
        "The document was not found.",
        "DOCUMENT_NOT_FOUND",
        404,
        undefined,
        { cause: error },
      );
    }
  }

  return new DocumentUploadError(
    "The document record could not be updated.",
    "DATABASE_UNAVAILABLE",
    503,
    undefined,
    { cause: error },
  );
}

export class DocumentUploadService {
  constructor(
    private readonly repository: DocumentUploadRepository,
    private readonly storage: StorageAdapter,
    private readonly storageConfig: StorageConfig = getStorageConfig(),
  ) {}

  async initialize(input: InitializeDocumentUploadInput): Promise<InitializeDocumentUploadResult> {
    const validated = validateInitializeInput(input, this.storageConfig);
    const knowledgeBaseId = input.knowledgeBaseId?.trim() || defaultKnowledgeBaseId();

    if (!UUID_PATTERN.test(knowledgeBaseId)) {
      throw new DocumentUploadError("The knowledge base ID is invalid.", "INVALID_REQUEST", 400);
    }

    const documentId = randomUUID();
    const path = [
      "knowledge-bases",
      knowledgeBaseId,
      "documents",
      documentId,
      `v1-${storageSafeFilename(validated.filename)}`,
    ].join("/");

    let document: DocumentUploadRecord;

    try {
      document = await this.repository.createUploading({
        id: documentId,
        knowledgeBaseId,
        displayName: validated.displayName,
        originalFilename: validated.filename,
        mimeType: validated.mimeType,
        fileExtension: validated.extension,
        storageBucket: this.storageConfig.bucket,
        storagePath: path,
        fileSizeBytes: input.sizeBytes,
        sha256: input.sha256.toLowerCase(),
        versionNo: 1,
      });
    } catch (error) {
      throw mapRepositoryError(error);
    }

    try {
      const upload = await this.storage.createSignedUpload({
        bucket: document.storageBucket,
        path: document.storagePath,
        upsert: false,
      });

      return {
        document,
        upload: {
          bucket: upload.bucket,
          path: upload.path,
          token: upload.token,
          signedUrl: upload.signedUrl,
          expiresAt: new Date(Date.now() + upload.expiresInSeconds * 1_000).toISOString(),
        },
      };
    } catch (error) {
      await this.repository
        .markFailed(
          document.id,
          "STORAGE_SIGNED_UPLOAD_FAILED",
          "A signed upload URL could not be created.",
        )
        .catch(() => undefined);

      throw new DocumentUploadError(
        "Document storage is temporarily unavailable.",
        "STORAGE_UNAVAILABLE",
        503,
        undefined,
        { cause: error },
      );
    }
  }

  async complete(documentId: string): Promise<CompleteDocumentUploadResult> {
    validateDocumentId(documentId);

    let document: DocumentUploadRecord | null;

    try {
      document = await this.repository.findById(documentId);
    } catch (error) {
      throw mapRepositoryError(error);
    }

    if (!document) {
      throw new DocumentUploadError("The document was not found.", "DOCUMENT_NOT_FOUND", 404);
    }

    if (COMPLETED_UPLOAD_STATES.has(document.status)) {
      return { document, idempotent: true };
    }

    if (!canTransitionDocumentStatus(document.status, "uploaded")) {
      throw new DocumentUploadError(
        "The document cannot complete upload from its current state.",
        "INVALID_DOCUMENT_STATE",
        409,
        { currentStatus: document.status },
      );
    }

    let metadata;

    try {
      metadata = await this.storage.getObjectMetadata(document.storageBucket, document.storagePath);
    } catch (error) {
      const message =
        error instanceof StorageError
          ? "The uploaded object could not be verified."
          : "Document storage is temporarily unavailable.";
      throw new DocumentUploadError(message, "STORAGE_UNAVAILABLE", 503, undefined, {
        cause: error,
      });
    }

    if (!metadata.exists) {
      throw new DocumentUploadError(
        "The uploaded file was not found. Upload it before completing the request.",
        "UPLOAD_NOT_FOUND",
        409,
      );
    }

    if (metadata.sizeBytes !== null && metadata.sizeBytes !== document.fileSizeBytes) {
      await this.repository
        .markFailed(document.id, "UPLOAD_SIZE_MISMATCH", "Uploaded file size did not match.")
        .catch(() => undefined);
      throw new DocumentUploadError(
        "The uploaded file size does not match the initialized document.",
        "UPLOAD_SIZE_MISMATCH",
        409,
        { expectedSizeBytes: document.fileSizeBytes, actualSizeBytes: metadata.sizeBytes },
      );
    }

    if (
      metadata.contentType &&
      normalizeMimeType(metadata.contentType) !== normalizeMimeType(document.mimeType)
    ) {
      await this.repository
        .markFailed(
          document.id,
          "UPLOAD_CONTENT_TYPE_MISMATCH",
          "Uploaded content type did not match.",
        )
        .catch(() => undefined);
      throw new DocumentUploadError(
        "The uploaded content type does not match the initialized document.",
        "UPLOAD_CONTENT_TYPE_MISMATCH",
        409,
        { expectedMimeType: document.mimeType, actualMimeType: metadata.contentType },
      );
    }

    try {
      const uploaded = await this.repository.markUploaded(document.id, new Date().toISOString());
      return { document: uploaded, idempotent: false };
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  async createPreview(documentId: string): Promise<{
    document: DocumentUploadRecord;
    signedUrl: string;
    expiresAt: string;
  }> {
    validateDocumentId(documentId);
    let document: DocumentUploadRecord | null;
    try {
      document = await this.repository.findById(documentId);
    } catch (error) {
      throw mapRepositoryError(error);
    }
    if (!document || !COMPLETED_UPLOAD_STATES.has(document.status)) {
      throw new DocumentUploadError("文档尚未上传完成或已不存在。", "DOCUMENT_NOT_FOUND", 404);
    }
    try {
      const signed = await this.storage.createSignedDownload(
        document.storageBucket,
        document.storagePath,
        DOCUMENT_PREVIEW_URL_TTL_SECONDS,
      );
      return {
        document,
        signedUrl: signed.signedUrl,
        expiresAt: new Date(Date.now() + signed.expiresInSeconds * 1_000).toISOString(),
      };
    } catch (error) {
      throw new DocumentUploadError("文档预览暂时不可用，请稍后重试。", "STORAGE_UNAVAILABLE", 503, undefined, { cause: error });
    }
  }

  async delete(documentId: string): Promise<DeleteDocumentResult> {
    validateDocumentId(documentId);
    let document: DocumentUploadRecord;
    try {
      const current = await this.repository.findById(documentId);
      if (!current) throw new DocumentUploadError("The document was not found.", "DOCUMENT_NOT_FOUND", 404);
      if (current.status === "deleting") document = current;
      else if (current.status === "deleted") return { documentId, deletedAt: current.updatedAt, idempotent: true };
      else document = await this.repository.markDeleting(documentId);
    } catch (error) {
      if (error instanceof DocumentUploadError) throw error;
      throw mapRepositoryError(error);
    }

    try {
      await this.storage.removeObject(document.storageBucket, document.storagePath);
    } catch (error) {
      await this.repository.markFailed(documentId, "DOCUMENT_DELETE_FAILED", "The source file could not be removed.").catch(() => undefined);
      throw new DocumentUploadError("文档删除失败，文件仍保留在私有存储中。请稍后重试。", "STORAGE_UNAVAILABLE", 503, undefined, { cause: error });
    }

    const deletedAt = new Date().toISOString();
    try {
      await this.repository.markDeleted(documentId, deletedAt);
    } catch (error) {
      throw mapRepositoryError(error);
    }
    return { documentId, deletedAt, idempotent: false };
  }
}
