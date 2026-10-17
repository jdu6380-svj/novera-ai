export class StorageError extends Error {
  constructor(
    message: string,
    readonly code:
      | "SIGNED_UPLOAD_CREATE_FAILED"
      | "SIGNED_DOWNLOAD_CREATE_FAILED"
      | "OBJECT_LOOKUP_FAILED"
      | "OBJECT_DOWNLOAD_FAILED"
      | "OBJECT_DELETE_FAILED",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StorageError";
  }
}
