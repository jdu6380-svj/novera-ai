import { describe, expect, it } from "vitest";

import { QualityEvaluator } from "./quality-evaluator";
import type { EvidenceVerificationResult } from "@/features/qa/domain/qa";
import { retrievalFixture } from "@/features/qa/application/test-fixtures";

describe("QualityEvaluator", () => {
  it("explains high confidence when retrieval and all claims are fully supported", () => {
    const verification: EvidenceVerificationResult = {
      claims: [
        {
          claimIndex: 0,
          claimText: "The flow changed.",
          claimType: "fact",
          weight: 1,
          supportStatus: "full",
          evidence: [],
          discardedEvidence: [],
        },
      ],
      validEvidenceCount: 1,
      invalidEvidenceCount: 0,
      unsupportedClaimCount: 0,
      conflictClaimCount: 0,
      details: {},
    };
    const result = new QualityEvaluator().evaluate(
      retrievalFixture,
      {
        answer: "The flow changed.",
        claims: [],
        limitations: [],
        insufficientEvidence: false,
      },
      verification,
    );

    expect(result.retrievalScore.score).toBeGreaterThan(0);
    expect(result.evidenceCoverage.score).toBe(100);
    expect(result.confidence.explanation).toContain("保守计算");
    expect(result.details).toMatchObject({ evaluator: "novera-quality-evaluator" });
  });

  it("penalizes unsupported claims and caps insufficient-evidence confidence", () => {
    const verification: EvidenceVerificationResult = {
      claims: [
        {
          claimIndex: 0,
          claimText: "Unsupported.",
          claimType: "analysis",
          weight: 1,
          supportStatus: "unsupported",
          evidence: [],
          discardedEvidence: [],
        },
      ],
      validEvidenceCount: 0,
      invalidEvidenceCount: 1,
      unsupportedClaimCount: 1,
      conflictClaimCount: 0,
      details: {},
    };
    const result = new QualityEvaluator().evaluate(
      retrievalFixture,
      {
        answer: "I cannot verify this.",
        claims: [],
        limitations: ["Not enough evidence."],
        insufficientEvidence: true,
      },
      verification,
    );

    expect(result.evidenceCoverage.score).toBe(0);
    expect(result.confidence.score).toBeLessThanOrEqual(49);
    expect(result.confidence.explanation).toContain("限制在 50 分以下");
  });
});
