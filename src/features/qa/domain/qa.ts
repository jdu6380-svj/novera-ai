import type { JsonObject, QualityScore, TaskType, UnderstoodTaskType, UUID } from "@/domain";
import type { BuiltPromptContext } from "@/features/retrieval/application/context-builder";
import type { RetrievalEngineResult } from "@/features/retrieval/application/retrieval-engine";
import type { RetrievedChunk } from "@/features/retrieval/domain/retrieval";

export const CLAIM_TYPES = [
  "fact",
  "analysis",
  "comparison",
  "recommendation",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export interface GeneratedEvidenceReference {
  citationLabel: string;
  quote: string;
}

export interface GeneratedClaim {
  claimText: string;
  claimType: ClaimType;
  weight: number;
  evidence: GeneratedEvidenceReference[];
}

export interface GeneratedStructuredAnswer {
  answer: string;
  claims: GeneratedClaim[];
  limitations: string[];
  insufficientEvidence: boolean;
}

export interface AnswerGeneratorResult {
  structuredAnswer: GeneratedStructuredAnswer;
  model: string | null;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  providerRequestId: string | null;
}

export interface VerifiedEvidence {
  citationLabel: string;
  quoteText: string;
  chunkId: UUID;
  documentId: UUID;
  retrievalResultId: UUID | null;
  documentName: string;
  documentVersion: number;
  locator: JsonObject;
  supportScore: QualityScore;
}

export type VerifiedClaimSupportStatus = "full" | "partial" | "unsupported" | "conflict";

export interface VerifiedClaim {
  claimIndex: number;
  claimText: string;
  claimType: ClaimType;
  weight: number;
  supportStatus: VerifiedClaimSupportStatus;
  evidence: VerifiedEvidence[];
  discardedEvidence: Array<{ citationLabel: string; quote: string; reason: string }>;
}

export interface EvidenceVerificationResult {
  claims: VerifiedClaim[];
  validEvidenceCount: number;
  invalidEvidenceCount: number;
  unsupportedClaimCount: number;
  conflictClaimCount: number;
  details: JsonObject;
}

export interface QualityMetric {
  score: QualityScore;
  explanation: string;
  details: JsonObject;
}

export interface QualityEvaluationResult {
  retrievalScore: QualityMetric;
  evidenceCoverage: QualityMetric;
  knowledgeMatch: QualityMetric;
  confidence: QualityMetric;
  details: JsonObject;
}

export interface SourceVerificationRecord {
  chunkId: UUID;
  documentId: UUID;
  documentName: string;
  documentVersion: number;
  documentStatus: "ready" | "not_ready";
  chunkText: string;
  locator: JsonObject;
}

export interface QaRunInput {
  query: string;
  knowledgeBaseId: UUID;
  requestedTaskType: TaskType;
  topK?: number;
  similarityThreshold?: number;
  documentIds?: readonly UUID[];
  conversationId?: UUID | null;
}

export interface QaPipelineResult {
  qaRunId: UUID;
  conversationId: UUID;
  userMessageId: UUID;
  assistantMessageId: UUID | null;
  query: string;
  taskUnderstanding: {
    requestedTaskType: TaskType;
    understoodTaskType: UnderstoodTaskType;
    confidence: number;
    details: JsonObject;
  };
  answer: GeneratedStructuredAnswer;
  claims: VerifiedClaim[];
  sources: Array<{
    citationLabel: string;
    documentId: UUID;
    documentName: string;
    documentVersion: number;
    locator: JsonObject;
  }>;
  quality: QualityEvaluationResult;
  status: "completed" | "insufficient_evidence";
  limitations: string[];
  retrievedChunks: RetrievedChunk[];
  context: BuiltPromptContext;
  runStats: {
    model: string | null;
    promptVersion: string;
    latencyMs: number;
    queryEmbeddingTokens: number | null;
    generationInputTokens: number | null;
    generationOutputTokens: number | null;
    estimatedCostUsd: number | null;
    pricingSource: string;
    ratesUsdPerMillionTokens: {
      embeddingInput: number;
      languageInput: number;
      languageOutput: number;
    };
  };
  persisted: boolean;
  retrievalEngineResult: RetrievalEngineResult;
}
