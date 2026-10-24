import { describe, expect, it } from "vitest";

import { qaAnswerFromHttp, workspaceDataFromHttp } from "./workspace-api";

describe("Phase 5 workspace API mapping", () => {
  it("maps the workspace read endpoint into the interactive view model", () => {
    const result = workspaceDataFromHttp({
      knowledge_base: {
        id: "kb-1",
        name: "Product knowledge",
        description: "Evidence-ready knowledge",
        health_score: 84,
      },
      documents: [
        {
          id: "doc-1",
          name: "PRD",
          type: "MD",
          status: "ready",
          updated_at: "2 minutes ago",
          size: "18 KB",
          chunks: 8,
          progress: 100,
          quality: "review_required",
          warnings: [{
            code: "PAGE_HAS_NO_EXTRACTABLE_TEXT",
            message: "A page needs review.",
            severity: "review_required",
            location: "Page 2",
            remediation: "Upload an OCR-processed PDF.",
          }],
          qa_eligible: false,
          remediation: "Upload an OCR-processed PDF.",
        },
      ],
      qa_runs: [],
      insights: [],
      latest_answer: {
        query: "",
        task_type: "qa",
        answer: "Ask a question.",
        limitations: [],
        insufficient_evidence: false,
        confidence: 0,
        claims: [],
        evidence: [],
        metrics: [],
        run_id: null,
        created_at: "Not run yet",
      },
    });

    expect(result.knowledgeBaseName).toBe("Product knowledge");
    expect(result.documents[0]).toMatchObject({
      type: "MD",
      chunks: 8,
      quality: "review_required",
      qaEligible: false,
      warnings: [{ location: "Page 2", severity: "review_required" }],
    });
    expect(result.answer.runId).toBe("");
    expect(result.dataMode).toBe("live");
  });

  it("maps a live QA response into Answer → Claim → Evidence → Metrics", () => {
    const result = qaAnswerFromHttp({
      qa_run_id: "run-1",
      query: "Why is churn increasing?",
      status: "completed",
      task_understanding: { task_type: "analysis" },
      answer: {
        answer: "Onboarding friction increased churn.",
        limitations: [],
        insufficient_evidence: false,
        claims: [
          {
            claim_index: 0,
            claim_text: "Onboarding friction increased churn.",
            claim_type: "analysis",
            support_status: "full",
            evidence: [
              {
                citation_label: "[S1]",
                quote: "Users cannot find the next step.",
                document_id: "doc-1",
                document_name: "Feedback report",
                locator: { page_start: 12, section_path: "Activation" },
                support_score: 100,
              },
            ],
          },
        ],
      },
      quality_scores: {
        retrieval_score: { score: 91, explanation: "Relevant." },
        evidence_coverage: { score: 100, explanation: "Covered." },
        knowledge_match: { score: 95, explanation: "Matched." },
        confidence: { score: 93, explanation: "Verified." },
      },
    });

    expect(result.taskType).toBe("analysis");
    expect(result.claims[0]?.evidenceIds).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      citationLabel: "[S1]",
      locator: "Activation · Page 12",
      relevanceScore: 0,
    });
    expect(result.metrics[3]).toMatchObject({ key: "confidence", score: 93 });
  });
});
