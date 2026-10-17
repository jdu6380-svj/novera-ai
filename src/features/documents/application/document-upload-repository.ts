import type { DocumentStatus } from "@/domain";

export interface UploadingDocumentRecord {
  id: string;
  knowledgeBaseId: string;
  displayName: string;
  originalFilename: string;
  mimeType: string;
  fileExtension: string;
  storageBucket: string;
  storagePath: string;
  fileSizeBytes: number;
  sha256: string;
  versionNo: number;
}

export interface DocumentUploadRecord extends UploadingDocumentRecord {
  status: DocumentStatus;
  uploadedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentUploadRepository {
  createUploading(record: UploadingDocumentRecord): Promise<DocumentUploadRecord>;
  findById(id: string): Promise<DocumentUploadRecord | null>;
  markUploaded(id: string, uploadedAt: string): Promise<DocumentUploadRecord>;
  markFailed(id: string, errorCode: string, errorMessage: string): Promise<void>;
  markDeleting(id: string): Promise<DocumentUploadRecord>;
  markDeleted(id: string, deletedAt: string): Promise<void>;
}

export class DocumentRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "DUPLICATE_DOCUMENT" | "DOCUMENT_NOT_FOUND" | "DOCUMENT_WRITE_FAILED",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentRepositoryError";
  }
}
