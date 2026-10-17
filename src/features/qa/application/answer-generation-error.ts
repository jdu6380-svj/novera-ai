export type AnswerGenerationErrorCode =
  | "INVALID_GENERATED_ANSWER"
  | "MODEL_GENERATION_FAILED"
  | "INSUFFICIENT_EVIDENCE";

export class AnswerGenerationError extends Error {
  constructor(
    message: string,
    readonly code: AnswerGenerationErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AnswerGenerationError";
  }
}
