import type { JsonObject, QaRunStatus, TaskType, UUID } from "@/domain";
import type { RetrievedChunk } from "@/features/retrieval/domain/retrieval";
import type {
  EvidenceVerificationResult,
  GeneratedStructuredAnswer,
  QualityEvaluationResult,
  VerifiedClaim,
} from "@/features/qa/domain/qa";

export interface StartQaRunInput {
  knowledgeBaseId: UUID;
  query: string;
  requestedTaskType: TaskType;
  conversationId?: UUID | null;
}

export interface StartedQaRun {
  qaRunId: UUID;
  conversationId: UUID;
  userMessageId: UUID;
}

export interface PersistQaRunInput {
  run: StartedQaRun;
  knowledgeBaseId: UUID;
  query: string;
  requestedTaskType: TaskType;
  classifiedTaskType: Exclude<TaskType, "auto">;
  classifierConfidence: number;
  taskUnderstandingDetails: JsonObject;
  retrievalConfig: JsonObject;
  retrievedChunks: RetrievedChunk[];
  selectedChunkIds: readonly UUID[];
  answer: GeneratedStructuredAnswer;
  verification: EvidenceVerificationResult;
  claims: VerifiedClaim[];
  quality: QualityEvaluationResult;
  status: Extract<QaRunStatus, "completed" | "insufficient_evidence">;
  model: string | null;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  queryEmbeddingTokens?: number | null;
  estimatedCostUsd?: number | null;
  pricingSource?: string;
  ratesUsdPerMillionTokens?: {
    embeddingInput: number;
    languageInput: number;
    languageOutput: number;
  };
  latencyMs: number;
  insufficientReason: string | null;
}

export interface QaRunRepository {
  start(input: StartQaRunInput): Promise<StartedQaRun>;
  setStatus(qaRunId: UUID, status: QaRunStatus): Promise<void>;
  complete(input: PersistQaRunInput): Promise<{ assistantMessageId: UUID }>;
  fail(input: {
    qaRunId: UUID;
    userMessageId: UUID;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
}

export type QaRunRepositoryErrorCode =
  | "START_FAILED"
  | "STATUS_UPDATE_FAILED"
  | "COMPLETE_FAILED"
  | "FAILURE_UPDATE_FAILED";

export class QaRunRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: QaRunRepositoryErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "QaRunRepositoryError";
  }
}
