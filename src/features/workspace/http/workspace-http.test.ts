import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { emptyWorkspaceAnswer } from "@/features/workspace/application/workspace-mapper";
import { parseKnowledgeBaseId, workspaceToHttp } from "./workspace-http";

describe("workspace HTTP contract", () => {
  it("defaults and validates the knowledge base identifier", () => {
    expect(parseKnowledgeBaseId(null)).toBe("00000000-0000-4000-8000-000000000001");
    expect(() => parseKnowledgeBaseId("not-a-uuid")).toThrow("valid UUID");
  });

  it("returns a product-facing workspace payload", () => {
    const body = workspaceToHttp(
      {
        knowledgeBaseId: "00000000-0000-4000-8000-000000000001",
        knowledgeBaseName: "Product knowledge",
        knowledgeBaseDescription: "Verified product context",
        healthScore: 82,
        documents: [{
          id: "doc-1",
          name: "Mixed scan.pdf",
          type: "PDF",
          status: "failed",
          updatedAt: "recently",
          size: "2 KB",
          chunks: 0,
          quality: "review_required",
          warnings: [{ code: "PARSER_REVIEW_REQUIRED", message: "Page 2 needs OCR.", location: "Page 2", remediation: "Upload an OCR-processed PDF." }],
          qaEligible: false,
          remediation: "Upload an OCR-processed PDF.",
        }],
        qaRuns: [],
        insights: [],
        answer: emptyWorkspaceAnswer(),
      },
      "trace-1",
    );

    expect(body.knowledge_base).toMatchObject({
      name: "Product knowledge",
      health_score: 82,
    });
    expect(body.latest_answer).toMatchObject({ run_id: null, confidence: 0 });
    expect(body.documents[0]).toMatchObject({
      quality: "review_required",
      qa_eligible: false,
      warnings: [{ location: "Page 2" }],
    });
    expect(body.trace_id).toBe("trace-1");
    expect(body.data_mode).toBe("live");
  });
});
