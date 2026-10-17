export class KnowledgeInsightError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_QUESTION" | "INVALID_CONFIDENCE" | "WRITE_FAILED",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "KnowledgeInsightError";
  }
}
