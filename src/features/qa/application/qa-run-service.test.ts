import { describe, expect, it } from "vitest";

import type { KnowledgeInsightService } from "@/features/knowledge-insights/application/knowledge-insight-service";
import type { RetrievalEngine } from "@/features/retrieval/application/retrieval-engine";
import type { AnswerGenerator } from "./answer-generator";
import type { EvidenceVerificationLayer } from "./evidence-verifier";
import type {
  PersistQaRunInput,
  QaRunRepository,
  StartedQaRun,
} from "./qa-run-repository";
import { QaRunService } from "./qa-run-service";
import { SAFE_INSUFFICIENT_EVIDENCE_ANSWER } from "./claim-extraction";
import { QualityEvaluator } from "./quality-evaluator";
import { retrievalFixture } from "./test-fixtures";
import type { QaRunStatus } from "@/domain";

const started: StartedQaRun = {
  qaRunId: "qa-run-1",
  conversationId: "conversation-1",
  userMessageId: "user-message-1",
};

class MemoryQaRunRepository implements QaRunRepository {
  readonly statuses: QaRunStatus[] = [];
  readonly failures: Array<{ errorCode: string; errorMessage: string }> = [];
  completeInput: PersistQaRunInput | undefined;

  async start(): Promise<StartedQaRun> {
    return started;
  }

  async setStatus(_qaRunId: string, status: QaRunStatus): Promise<void> {
    this.statuses.push(status);
  }

  async complete(input: PersistQaRunInput): Promise<{ assistantMessageId: string }> {
    this.completeInput = input;
    return { assistantMessageId: "assistant-message-1" };
  }

  async fail(input: {
    qaRunId: string;
    userMessageId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    this.failures.push({ errorCode: input.errorCode, errorMessage: input.errorMessage });
  }
}

describe("QaRunService", () => {
  it("orchestrates retrieval through persistence and records a frequent-question insight", async () => {
    const repository = new MemoryQaRunRepository();
    const observed: Array<{ insightType: string }> = [];
    const insightService = {
      observe: async (input: { insightType: string }) => {
        observed.push(input);
        return {};
      },
    } as unknown as KnowledgeInsightService;
    const service = new QaRunService(
      {
        execute: async () => retrievalFixture,
      } as unknown as RetrievalEngine,
      {
        generate: async () => ({
          structuredAnswer: {
            answer: "The onboarding flow changed.",
            claims: [
              {
                claimText: "The onboarding flow changed.",
                claimType: "fact" as const,
                weight: 1,
                evidence: [
                  {
                    citationLabel: "[S1]",
                    quote: "The onboarding flow changed.",
                  },
                ],
              },
            ],
            limitations: [],
            insufficientEvidence: false,
          },
          model: "fake-model",
          promptVersion: "phase4-test",
          inputTokens: 10,
          outputTokens: 20,
          providerRequestId: "provider-request-1",
        }),
      } as unknown as AnswerGenerator,
      {
        verify: async () => ({
          claims: [
            {
              claimIndex: 0,
              claimText: "The onboarding flow changed.",
              claimType: "fact" as const,
              weight: 1,
              supportStatus: "full" as const,
              evidence: [
                {
                  citationLabel: "[S1]",
                  quoteText: "The onboarding flow changed.",
                  chunkId: "chunk-1",
                  documentId: "doc-1",
                  retrievalResultId: null,
                  documentName: "PRD",
                  documentVersion: 1,
                  locator: { section_path: "Onboarding" },
                  supportScore: 100,
                },
              ],
              discardedEvidence: [],
            },
          ],
          validEvidenceCount: 1,
          invalidEvidenceCount: 0,
          unsupportedClaimCount: 0,
          conflictClaimCount: 0,
          details: {},
        }),
      } as unknown as EvidenceVerificationLayer,
      new QualityEvaluator(),
      repository,
      insightService,
    );

    const result = await service.execute({
      query: "What changed?",
      knowledgeBaseId: "knowledge-base-1",
      requestedTaskType: "qa",
    });

    expect(result.status).toBe("completed");
    expect(result.persisted).toBe(true);
    expect(result.runStats).toMatchObject({
      model: "fake-model",
      generationInputTokens: 10,
      generationOutputTokens: 20,
    });
    expect(result.sources).toEqual([
      expect.objectContaining({ citationLabel: "[S1]", documentId: "doc-1" }),
    ]);
    expect(repository.completeInput).toMatchObject({
      status: "completed",
      model: "fake-model",
      queryEmbeddingTokens: 5,
      selectedChunkIds: ["chunk-1"],
    });
    expect(repository.statuses).toEqual([
      "classifying",
      "retrieving",
      "generating",
      "verifying",
      "evaluating",
    ]);
    expect(observed.map((item) => item.insightType)).toContain("frequent_question");
  });

  it("persists a failed terminal state when generation throws", async () => {
    const repository = new MemoryQaRunRepository();
    const service = new QaRunService(
      { execute: async () => retrievalFixture } as unknown as RetrievalEngine,
      {
        generate: async () => {
          throw new Error("model unavailable");
        },
      } as unknown as AnswerGenerator,
      { verify: async () => { throw new Error("unreachable"); } } as unknown as EvidenceVerificationLayer,
      new QualityEvaluator(),
      repository,
    );

    await expect(
      service.execute({
        query: "What changed?",
        knowledgeBaseId: "knowledge-base-1",
        requestedTaskType: "qa",
      }),
    ).rejects.toThrow("model unavailable");
    expect(repository.failures).toEqual([
      { errorCode: "Error", errorMessage: "model unavailable" },
    ]);
  });

  it("replaces unverified model prose while retaining unsupported claims for audit", async () => {
    const repository = new MemoryQaRunRepository();
    const service = new QaRunService(
      { execute: async () => retrievalFixture } as unknown as RetrievalEngine,
      {
        generate: async () => ({
          structuredAnswer: {
            answer: "Unverified model prose must not be returned.",
            claims: [
              {
                claimText: "The onboarding flow changed.",
                claimType: "fact" as const,
                weight: 1,
                evidence: [
                  {
                    citationLabel: "[S1]",
                    quote: "A quote that will fail verification.",
                  },
                ],
              },
            ],
            limitations: [],
            insufficientEvidence: false,
          },
          model: "fake-model",
          promptVersion: "phase4-test",
          inputTokens: 10,
          outputTokens: 20,
          providerRequestId: "provider-request-2",
        }),
      } as unknown as AnswerGenerator,
      {
        verify: async () => ({
          claims: [
            {
              claimIndex: 0,
              claimText: "The onboarding flow changed.",
              claimType: "fact" as const,
              weight: 1,
              supportStatus: "unsupported" as const,
              evidence: [],
              discardedEvidence: [
                {
                  citationLabel: "[S1]",
                  quote: "A quote that will fail verification.",
                  reason: "quote_not_in_database_source",
                },
              ],
            },
          ],
          validEvidenceCount: 0,
          invalidEvidenceCount: 1,
          unsupportedClaimCount: 1,
          conflictClaimCount: 0,
          details: {},
        }),
      } as unknown as EvidenceVerificationLayer,
      new QualityEvaluator(),
      repository,
    );

    const result = await service.execute({
      query: "What changed?",
      knowledgeBaseId: "knowledge-base-1",
      requestedTaskType: "qa",
    });

    expect(result.status).toBe("insufficient_evidence");
    expect(result.answer.answer).toBe(SAFE_INSUFFICIENT_EVIDENCE_ANSWER);
    expect(result.answer.answer).not.toContain("Unverified model prose");
    expect(result.answer.insufficientEvidence).toBe(true);
    expect(result.sources).toEqual([]);
    expect(result.claims).toEqual([
      expect.objectContaining({ supportStatus: "unsupported", evidence: [] }),
    ]);
    expect(result.quality.confidence.score).toBeLessThanOrEqual(49);
    expect(result.quality.details).toMatchObject({ insufficient_evidence: true });
    expect(repository.completeInput).toMatchObject({
      status: "insufficient_evidence",
      answer: {
        answer: SAFE_INSUFFICIENT_EVIDENCE_ANSWER,
        insufficientEvidence: true,
      },
      claims: [expect.objectContaining({ supportStatus: "unsupported" })],
    });
  });
});
