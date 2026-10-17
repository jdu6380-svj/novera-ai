import { describe, expect, it } from "vitest";

import type {
  KnowledgeInsightLog,
  RecordKnowledgeInsightInput,
} from "@/domain";
import type { KnowledgeInsightRepository } from "@/features/knowledge-insights/application/knowledge-insight-repository";
import {
  hashKnowledgeQuestion,
  KnowledgeInsightService,
  normalizeKnowledgeQuestion,
} from "@/features/knowledge-insights/application/knowledge-insight-service";

const KNOWLEDGE_BASE_ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-08-02T00:00:00.000Z";

class MemoryKnowledgeInsightRepository implements KnowledgeInsightRepository {
  readonly inputs: RecordKnowledgeInsightInput[] = [];

  async record(input: RecordKnowledgeInsightInput): Promise<KnowledgeInsightLog> {
    this.inputs.push(input);

    return {
      id: "00000000-0000-4000-8000-000000000010",
      knowledgeBaseId: input.knowledgeBaseId,
      insightType: input.insightType,
      status: "open",
      questionText: input.questionText,
      normalizedQuestion: input.normalizedQuestion,
      questionHash: input.questionHash,
      occurrenceCount: 1,
      latestQaRunId: input.latestQaRunId ?? null,
      confidenceScore: input.confidenceScore ?? null,
      details: input.details ?? {},
      firstObservedAt: NOW,
      lastObservedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    };
  }
}

describe("KnowledgeInsightService", () => {
  it("normalizes and fingerprints equivalent questions deterministically", () => {
    const first = normalizeKnowledgeQuestion("  Why   are users leaving? ");
    const second = normalizeKnowledgeQuestion("WHY ARE USERS LEAVING?");

    expect(first).toBe("why are users leaving?");
    expect(second).toBe(first);
    expect(hashKnowledgeQuestion(first)).toBe(hashKnowledgeQuestion(second));
    expect(hashKnowledgeQuestion(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records a lightweight insight without mutating knowledge content", async () => {
    const repository = new MemoryKnowledgeInsightRepository();
    const service = new KnowledgeInsightService(repository);

    const result = await service.observe({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      insightType: "unanswered_question",
      questionText: "  Why   are users leaving? ",
      confidenceScore: 22,
      details: { trigger: "insufficient_evidence" },
    });

    expect(result.insightType).toBe("unanswered_question");
    expect(repository.inputs[0]).toMatchObject({
      questionText: "Why   are users leaving?",
      normalizedQuestion: "why are users leaving?",
      confidenceScore: 22,
      details: { trigger: "insufficient_evidence" },
    });
  });

  it("rejects empty questions and invalid confidence values", async () => {
    const service = new KnowledgeInsightService(new MemoryKnowledgeInsightRepository());

    await expect(
      service.observe({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        insightType: "knowledge_gap",
        questionText: "   ",
      }),
    ).rejects.toMatchObject({ code: "INVALID_QUESTION" });

    await expect(
      service.observe({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        insightType: "low_confidence_answer",
        questionText: "What changed?",
        confidenceScore: 101,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIDENCE" });
  });
});
