import { createHash } from "node:crypto";

import type {
  JsonObject,
  KnowledgeInsightLog,
  KnowledgeInsightType,
  QualityScore,
  UUID,
} from "@/domain";
import { KnowledgeInsightError } from "@/features/knowledge-insights/application/knowledge-insight-error";
import type { KnowledgeInsightRepository } from "@/features/knowledge-insights/application/knowledge-insight-repository";

export interface ObserveKnowledgeInsightInput {
  knowledgeBaseId: UUID;
  insightType: KnowledgeInsightType;
  questionText: string;
  latestQaRunId?: UUID | null;
  confidenceScore?: QualityScore | null;
  details?: JsonObject;
}

export function normalizeKnowledgeQuestion(question: string): string {
  return question.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function hashKnowledgeQuestion(normalizedQuestion: string): string {
  return createHash("sha256").update(normalizedQuestion, "utf8").digest("hex");
}

export class KnowledgeInsightService {
  constructor(private readonly repository: KnowledgeInsightRepository) {}

  async observe(input: ObserveKnowledgeInsightInput): Promise<KnowledgeInsightLog> {
    const questionText = input.questionText.normalize("NFKC").trim();
    const normalizedQuestion = normalizeKnowledgeQuestion(questionText);

    if (!normalizedQuestion) {
      throw new KnowledgeInsightError(
        "A non-empty question is required for a knowledge insight.",
        "INVALID_QUESTION",
      );
    }

    if (
      input.confidenceScore !== undefined &&
      input.confidenceScore !== null &&
      (!Number.isFinite(input.confidenceScore) ||
        input.confidenceScore < 0 ||
        input.confidenceScore > 100)
    ) {
      throw new KnowledgeInsightError(
        "Knowledge insight confidence must be between 0 and 100.",
        "INVALID_CONFIDENCE",
      );
    }

    try {
      return await this.repository.record({
        knowledgeBaseId: input.knowledgeBaseId,
        insightType: input.insightType,
        questionText,
        normalizedQuestion,
        questionHash: hashKnowledgeQuestion(normalizedQuestion),
        latestQaRunId: input.latestQaRunId ?? null,
        confidenceScore: input.confidenceScore ?? null,
        details: input.details ?? {},
      });
    } catch (error) {
      if (error instanceof KnowledgeInsightError) {
        throw error;
      }

      throw new KnowledgeInsightError(
        "The knowledge insight could not be recorded.",
        "WRITE_FAILED",
        { cause: error },
      );
    }
  }
}
