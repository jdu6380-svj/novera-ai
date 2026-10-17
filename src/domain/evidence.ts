import type {
  ISODateTime,
  JsonObject,
  QualityScore,
  UUID,
} from "./primitives";

export const CLAIM_SUPPORT_STATUSES = [
  "full",
  "partial",
  "unsupported",
  "conflict",
] as const;

export type ClaimSupportStatus =
  (typeof CLAIM_SUPPORT_STATUSES)[number];

export interface AnswerClaim {
  id: UUID;
  qaRunId: UUID;
  claimIndex: number;
  claimText: string;
  claimType: string | null;
  weight: number;
  supportStatus: ClaimSupportStatus;
  createdAt: ISODateTime;
}

/** Immutable evidence snapshot backing one answer claim. */
export interface EvidenceItem {
  id: UUID;
  claimId: UUID;
  qaRunId: UUID;
  retrievalResultId: UUID | null;
  chunkId: UUID | null;
  documentId: UUID | null;
  citationLabel: string;
  quoteText: string;
  locator: JsonObject;
  supportScore: QualityScore | null;
  documentNameSnapshot: string;
  documentVersionSnapshot: number | null;
  createdAt: ISODateTime;
}

export const FEEDBACK_RATINGS = ["up", "down"] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export const FEEDBACK_REASONS = [
  "incorrect",
  "incomplete",
  "unsupported",
  "irrelevant",
  "format_issue",
  "other",
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export interface QaFeedback {
  id: UUID;
  qaRunId: UUID;
  rating: FeedbackRating;
  reason: FeedbackReason | null;
  comment: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** The core trust-chain returned by the Evidence Layer. */
export interface TraceableAnswer {
  answer: string;
  claims: Array<
    AnswerClaim & {
      evidence: EvidenceItem[];
    }
  >;
}
