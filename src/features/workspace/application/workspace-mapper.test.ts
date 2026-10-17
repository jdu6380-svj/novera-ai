import { describe, expect, it } from "vitest";

import {
  buildWorkspaceData,
  emptyWorkspaceAnswer,
  formatFileSize,
  formatLocator,
} from "./workspace-mapper";

const now = new Date("2026-08-04T12:00:00.000Z");

describe("workspace mapper", () => {
  it("maps documents, insights, runs, and the latest evidence chain", () => {
    const sourceDocumentIdsByRun = new Map<string, ReadonlySet<string>>([
      ["run-1", new Set(["doc-1"])],
    ]);
    const result = buildWorkspaceData({
      knowledgeBase: { id: "kb-1", name: "Product knowledge", description: null },
      documents: [
        {
          id: "doc-1",
          display_name: "Feedback report",
          file_extension: "pdf",
          file_size_bytes: 2_097_152,
          status: "ready",
          progress_pct: 100,
          chunk_count: 12,
          updated_at: "2026-08-04T11:55:00.000Z",
        },
      ],
      qaRuns: [
        {
          id: "run-1",
          query: "Why is churn increasing?",
          classified_task_type: "analysis",
          requested_task_type: "auto",
          status: "completed",
          answer_payload: { limitations: ["Channel data is missing."], insufficient_evidence: false },
          answer_text: "Onboarding friction increased churn.",
          metric_details: {
            confidence: { explanation: "Evidence is consistent." },
          },
          retrieval_score: 91,
          evidence_coverage_score: 88,
          knowledge_match_score: 86,
          confidence_score: 87,
          created_at: "2026-08-04T11:58:00.000Z",
        },
      ],
      claims: [
        {
          id: "claim-1",
          qa_run_id: "run-1",
          claim_index: 0,
          claim_text: "Onboarding friction increased churn.",
          claim_type: "analysis",
          support_status: "full",
        },
      ],
      evidence: [
        {
          id: "evidence-1",
          claim_id: "claim-1",
          qa_run_id: "run-1",
          retrieval_result_id: "retrieval-1",
          document_id: "doc-1",
          citation_label: "[S1]",
          quote_text: "Users cannot find the next step.",
          locator: { page_start: 12, section_path: "Activation" },
          support_score: 100,
          document_name_snapshot: "Feedback report",
        },
      ],
      retrievalRows: [{ id: "retrieval-1", relevance_score: 94 }],
      insights: [
        {
          id: "insight-1",
          insight_type: "knowledge_gap",
          question_text: "Where is the billing SOP?",
          occurrence_count: 3,
          confidence_score: 45,
          details: { reason: "No READY document." },
          last_observed_at: "2026-08-04T11:00:00.000Z",
        },
      ],
      sourceDocumentIdsByRun,
      now,
    });

    expect(result.documents[0]).toMatchObject({ type: "PDF", size: "2.0 MB", status: "ready" });
    expect(result.qaRuns[0]).toMatchObject({ taskType: "analysis", sourceCount: 1 });
    expect(result.insights[0]).toMatchObject({ type: "gap", label: "Knowledge gap" });
    expect(result.answer.claims[0]?.evidenceIds).toEqual(["evidence-1"]);
    expect(result.answer.evidence[0]).toMatchObject({ citationLabel: "[S1]", relevanceScore: 94 });
    expect(result.answer.metrics[3]).toMatchObject({ score: 87, explanation: "Evidence is consistent." });
  });

  it("returns an explicit empty answer when no completed QA run exists", () => {
    expect(emptyWorkspaceAnswer()).toMatchObject({ runId: "", confidence: 0, claims: [] });
  });

  it("formats source locators and file sizes for product display", () => {
    expect(formatLocator({ section_path: "Activation", page_start: 2, page_end: 3 })).toBe(
      "Activation · Pages 2–3",
    );
    expect(formatFileSize(1_024)).toBe("1 KB");
  });
});
