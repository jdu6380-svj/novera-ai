import type {
  ISODateTime,
  JsonObject,
  QualityScore,
  UUID,
} from "./primitives";

export const CHAT_ROLES = ["user", "assistant", "system"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export const CHAT_MESSAGE_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;
export type ChatMessageStatus = (typeof CHAT_MESSAGE_STATUSES)[number];

export const TASK_TYPES = [
  "auto",
  "qa",
  "summary",
  "analysis",
  "compare",
  "recommend",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type UnderstoodTaskType = Exclude<TaskType, "auto">;

export const QA_RUN_STATUSES = [
  "pending",
  "classifying",
  "retrieving",
  "generating",
  "verifying",
  "evaluating",
  "completed",
  "insufficient_evidence",
  "failed",
] as const;
export type QaRunStatus = (typeof QA_RUN_STATUSES)[number];

/** Public-facing replacement for the earlier "Task Classification Agent" name. */
export interface TaskUnderstandingResult {
  requestedTaskType: TaskType;
  understoodTaskType: UnderstoodTaskType;
  confidence: number;
  details: JsonObject;
}

export interface Conversation {
  id: UUID;
  knowledgeBaseId: UUID;
  title: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ChatMessage {
  id: UUID;
  conversationId: UUID;
  role: ChatRole;
  content: string;
  taskType: TaskType | null;
  status: ChatMessageStatus;
  qaRunId: UUID | null;
  model: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: ISODateTime;
}

export interface QualityMetrics {
  retrievalScore: QualityScore | null;
  evidenceCoverageScore: QualityScore | null;
  knowledgeMatchScore: QualityScore | null;
  confidenceScore: QualityScore | null;
  details: JsonObject;
}

export interface QaRun extends QualityMetrics {
  id: UUID;
  conversationId: UUID;
  userMessageId: UUID;
  assistantMessageId: UUID | null;
  query: string;
  requestedTaskType: TaskType;
  classifiedTaskType: UnderstoodTaskType | null;
  classifierConfidence: number | null;
  taskUnderstandingDetails: JsonObject;
  status: QaRunStatus;
  retrievalConfig: JsonObject;
  answerPayload: JsonObject;
  answerText: string | null;
  model: string | null;
  promptVersion: string | null;
  insufficientReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  startedAt: ISODateTime | null;
  completedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface RetrievalResult {
  id: UUID;
  qaRunId: UUID;
  chunkId: UUID | null;
  documentId: UUID | null;
  rank: number;
  distance: number | null;
  relevanceScore: QualityScore;
  selected: boolean;
  documentNameSnapshot: string;
  chunkTextSnapshot: string;
  locatorSnapshot: JsonObject;
  createdAt: ISODateTime;
}
