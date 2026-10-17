import { describe, expect, it } from "vitest";

import { parseQaRunRequest, qaRunResultToHttp } from "./qa-run-http";
import type { QaPipelineResult } from "@/features/qa/domain/qa";
import { retrievalFixture } from "@/features/qa/application/test-fixtures";

describe("QA run HTTP contract", () => {
  it("accepts optional conversation reuse and validates retrieval controls", () => {
    expect(
      parseQaRunRequest({
        query: "Why are users leaving?",
        task_type: "analysis",
        conversation_id: "00000000-0000-4000-8000-000000000010",
        top_k: 6,
      }),
    ).toMatchObject({
      query: "Why are users leaving?",
      requestedTaskType: "analysis",
      topK: 6,
      conversationId: "00000000-0000-4000-8000-000000000010",
    });

    expect(() => parseQaRunRequest({ query: "", unknown: true })).toThrow();
  });

  it("returns Answer -> Claim -> Evidence -> Source plus explained quality scores", () => {
    const result: QaPipelineResult = {
      qaRunId: "qa-1",
      conversationId: "conversation-1",
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
      query: "What changed?",
      taskUnderstanding: {
        requestedTaskType: "qa",
        understoodTaskType: "qa",
        confidence: 0.9,
        details: {},
      },
      answer: {
        answer: "The flow changed.",
        claims: [],
        limitations: [],
        insufficientEvidence: false,
      },
      claims: [
        {
          claimIndex: 0,
          claimText: "The flow changed.",
          claimType: "fact",
          weight: 1,
          supportStatus: "full",
          discardedEvidence: [],
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
        },
      ],
      sources: [
        {
          citationLabel: "[S1]",
          documentId: "doc-1",
          documentName: "PRD",
          documentVersion: 1,
          locator: { section_path: "Onboarding" },
        },
      ],
      quality: {
        retrievalScore: { score: 85, explanation: "Relevant", details: {} },
        evidenceCoverage: { score: 100, explanation: "Covered", details: {} },
        knowledgeMatch: { score: 92, explanation: "Matched", details: {} },
        confidence: { score: 90, explanation: "Verified", details: {} },
        details: {},
      },
      status: "completed",
      limitations: [],
      retrievedChunks: retrievalFixture.retrieval.chunks,
      context: retrievalFixture.context,
      runStats: {
        model: "gpt-5-mini",
        promptVersion: "phase4-v1",
        latencyMs: 850,
        queryEmbeddingTokens: 8,
        generationInputTokens: 120,
        generationOutputTokens: 40,
        estimatedCostUsd: 0.00011016,
        pricingSource: "test-pricing",
        ratesUsdPerMillionTokens: {
          embeddingInput: 0.02,
          languageInput: 0.25,
          languageOutput: 2,
        },
      },
      persisted: true,
      retrievalEngineResult: retrievalFixture,
    };
    const body = qaRunResultToHttp(result, "trace-1");

    expect(body.answer.claims[0]).toMatchObject({
      support_status: "full",
      evidence: [
        expect.objectContaining({
          citation_label: "[S1]",
          document_id: "doc-1",
        }),
      ],
    });
    expect(body.sources[0]).toMatchObject({ document_name: "PRD" });
    expect(body.quality_scores.confidence).toMatchObject({
      score: 90,
      explanation: "Verified",
    });
    expect(body.run_stats).toMatchObject({
      latency_ms: 850,
      estimated_cost_usd: 0.00011016,
      pricing_source: "test-pricing",
    });
  });
});
