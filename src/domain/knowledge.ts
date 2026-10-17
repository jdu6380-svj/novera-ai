import type {
  ISODateTime,
  JsonObject,
  QualityScore,
  UUID,
} from "./primitives";

export interface KnowledgeBase {
  id: UUID;
  slug: string;
  name: string;
  description: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export const KNOWLEDGE_INSIGHT_TYPES = [
  "frequent_question",
  "unanswered_question",
  "low_confidence_answer",
  "knowledge_gap",
] as const;

export type KnowledgeInsightType =
  (typeof KNOWLEDGE_INSIGHT_TYPES)[number];

export const KNOWLEDGE_INSIGHT_STATUSES = [
  "open",
  "reviewed",
  "resolved",
  "ignored",
] as const;

export type KnowledgeInsightStatus =
  (typeof KNOWLEDGE_INSIGHT_STATUSES)[number];

/**
 * An aggregated observation only. Phase 1 intentionally does not feed these
 * records back into prompts, documents, or embeddings automatically.
 */
export interface KnowledgeInsightLog {
  id: UUID;
  knowledgeBaseId: UUID;
  insightType: KnowledgeInsightType;
  status: KnowledgeInsightStatus;
  questionText: string;
  normalizedQuestion: string;
  questionHash: string;
  occurrenceCount: number;
  latestQaRunId: UUID | null;
  confidenceScore: QualityScore | null;
  details: JsonObject;
  firstObservedAt: ISODateTime;
  lastObservedAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface RecordKnowledgeInsightInput {
  knowledgeBaseId: UUID;
  insightType: KnowledgeInsightType;
  questionText: string;
  normalizedQuestion: string;
  questionHash: string;
  latestQaRunId?: UUID | null;
  confidenceScore?: QualityScore | null;
  details?: JsonObject;
}
