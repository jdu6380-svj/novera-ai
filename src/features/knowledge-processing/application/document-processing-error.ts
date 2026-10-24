export type DocumentProcessingErrorCode =
  | "INVALID_REQUEST"
  | "DOCUMENT_NOT_FOUND"
  | "JOB_NOT_FOUND"
  | "INVALID_DOCUMENT_STATE"
  | "INVALID_JOB_STATE"
  | "MAX_ATTEMPTS_REACHED"
  | "STORAGE_DOWNLOAD_FAILED"
  | "STORAGE_OBJECT_MISMATCH"
  | "PARSER_FAILED"
  | "PARSER_REVIEW_REQUIRED"
  | "NORMALIZATION_FAILED"
  | "CHUNKING_FAILED"
  | "EMBEDDING_FAILED"
  | "PROCESSING_PERSISTENCE_FAILED";

export class DocumentProcessingError extends Error {
  constructor(
    message: string,
    readonly code: DocumentProcessingErrorCode,
    readonly httpStatus: number,
    readonly details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentProcessingError";
  }
}
