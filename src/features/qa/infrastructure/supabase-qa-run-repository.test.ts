import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PersistQaRunInput } from "@/features/qa/application/qa-run-repository";
import { retrievalFixture } from "@/features/qa/application/test-fixtures";
import { SupabaseQaRunRepository } from "./supabase-qa-run-repository";

function persistInput(): PersistQaRunInput {
  const verifiedClaim = {
    claimIndex: 0,
    claimText: "The onboarding flow changed.",
    claimType: "fact" as const,
    weight: 1,
    supportStatus: "full" as const,
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
  };

  return {
    run: {
      qaRunId: "qa-run-1",
      conversationId: "conversation-1",
      userMessageId: "user-message-1",
    },
    knowledgeBaseId: "knowledge-base-1",
    query: "What changed?",
    requestedTaskType: "qa",
    classifiedTaskType: "qa",
    classifierConfidence: 0.9,
    taskUnderstandingDetails: {},
    retrievalConfig: { top_k: 8 },
    retrievedChunks: retrievalFixture.retrieval.chunks,
    selectedChunkIds: ["chunk-1"],
    answer: {
      answer: "The onboarding flow changed.",
      claims: [
        {
          claimText: "The onboarding flow changed.",
          claimType: "fact",
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
    verification: {
      claims: [verifiedClaim],
      validEvidenceCount: 1,
      invalidEvidenceCount: 0,
      unsupportedClaimCount: 0,
      conflictClaimCount: 0,
      details: { verification: "exact" },
    },
    claims: [verifiedClaim],
    quality: {
      retrievalScore: { score: 85, explanation: "Relevant", details: {} },
      evidenceCoverage: { score: 100, explanation: "Covered", details: {} },
      knowledgeMatch: { score: 92, explanation: "Matched", details: {} },
      confidence: { score: 90, explanation: "Verified", details: {} },
      details: { evaluator: "test" },
    },
    status: "completed",
    model: "fake-model",
    promptVersion: "phase4-test",
    inputTokens: 10,
    outputTokens: 20,
    latencyMs: 42,
    insufficientReason: null,
  };
}

describe("SupabaseQaRunRepository", () => {
  it("maps the complete trace into one transactional RPC payload", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ assistant_message_id: "assistant-message-1" }],
      error: null,
    });
    const repository = new SupabaseQaRunRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.complete(persistInput())).resolves.toEqual({
      assistantMessageId: "assistant-message-1",
    });

    expect(rpc).toHaveBeenCalledWith(
      "complete_qa_run",
      expect.objectContaining({
        p_qa_run_id: "qa-run-1",
        p_status: "completed",
        p_answer_payload: expect.objectContaining({
          answer: "The onboarding flow changed.",
          insufficient_evidence: false,
        }),
        p_retrieval_rows: [
          expect.objectContaining({
            chunk_id: "chunk-1",
            document_id: "doc-1",
            selected: true,
            relevance_score: 85,
            chunk_text_snapshot: "The onboarding flow changed.",
            locator_snapshot: expect.objectContaining({ citation_label: "[S1]" }),
          }),
        ],
        p_claim_rows: [
          expect.objectContaining({ claim_index: 0, support_status: "full" }),
        ],
        p_evidence_rows: [
          expect.objectContaining({
            claim_index: 0,
            citation_label: "[S1]",
            quote_text: "The onboarding flow changed.",
            chunk_id: "chunk-1",
          }),
        ],
        p_metrics: expect.objectContaining({
          confidence: expect.objectContaining({ score: 90, explanation: "Verified" }),
        }),
      }),
    );
  });

  it("creates a run and updates lifecycle status through server-only RPCs", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [
          {
            qa_run_id: "qa-run-1",
            conversation_id: "conversation-1",
            user_message_id: "user-message-1",
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    const repository = new SupabaseQaRunRepository({ rpc } as unknown as SupabaseClient);

    await expect(
      repository.start({
        knowledgeBaseId: "knowledge-base-1",
        query: "What changed?",
        requestedTaskType: "qa",
        conversationId: null,
      }),
    ).resolves.toEqual({
      qaRunId: "qa-run-1",
      conversationId: "conversation-1",
      userMessageId: "user-message-1",
    });
    await repository.setStatus("qa-run-1", "retrieving");

    expect(rpc).toHaveBeenNthCalledWith(2, "set_qa_run_status", {
      p_qa_run_id: "qa-run-1",
      p_status: "retrieving",
    });
  });
});
