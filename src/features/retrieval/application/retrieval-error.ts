export type RetrievalErrorCode =
  | "INVALID_REQUEST"
  | "QUERY_EMBEDDING_FAILED"
  | "VECTOR_RETRIEVAL_FAILED";

export class RetrievalError extends Error {
  constructor(
    message: string,
    readonly code: RetrievalErrorCode,
    readonly httpStatus: number,
    readonly details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RetrievalError";
  }
}
