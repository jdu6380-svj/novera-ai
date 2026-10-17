export type DocumentUploadErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_FILE_NAME"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_EMPTY"
  | "FILE_TOO_LARGE"
  | "INVALID_CHECKSUM"
  | "DUPLICATE_DOCUMENT"
  | "DOCUMENT_NOT_FOUND"
  | "INVALID_DOCUMENT_STATE"
  | "UPLOAD_NOT_FOUND"
  | "UPLOAD_SIZE_MISMATCH"
  | "UPLOAD_CONTENT_TYPE_MISMATCH"
  | "STORAGE_UNAVAILABLE"
  | "DATABASE_UNAVAILABLE";

export class DocumentUploadError extends Error {
  constructor(
    message: string,
    readonly code: DocumentUploadErrorCode,
    readonly httpStatus: number,
    readonly details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentUploadError";
  }
}
