import { describe, expect, it } from "vitest";

import {
  ClaimExtractionLayer,
  SAFE_INSUFFICIENT_EVIDENCE_ANSWER,
} from "./claim-extraction";

describe("ClaimExtractionLayer", () => {
  it("validates, deduplicates, and normalizes claims without losing exact quotes", () => {
    const result = new ClaimExtractionLayer().extract({
      answer: "Users are blocked at onboarding.",
      claims: [
        {
          claim_text: " Users are blocked at onboarding. ",
          claim_type: "fact",
          weight: 1.23456,
          evidence: [
            { citation_label: "[S1]", quote: "They cannot find the next step." },
            { citation_label: "[S1]", quote: "They cannot find the next step." },
          ],
        },
        {
          claim_text: "users are blocked at onboarding.",
          claim_type: "fact",
          weight: 1,
          evidence: [],
        },
      ],
      limitations: ["  Source is limited. ", "Source is limited."],
      insufficient_evidence: false,
    });

    expect(result).toEqual({
      answer: "Users are blocked at onboarding.",
      claims: [
        {
          claimText: "Users are blocked at onboarding.",
          claimType: "fact",
          weight: 1.235,
          evidence: [{ citationLabel: "[S1]", quote: "They cannot find the next step." }],
        },
      ],
      limitations: ["Source is limited."],
      insufficientEvidence: false,
    });
  });

  it("requires a limitation when the generator declares insufficient evidence", () => {
    const result = new ClaimExtractionLayer().extract({
      answer: "I cannot verify this.",
      claims: [],
      limitations: [],
      insufficient_evidence: true,
    });

    expect(result.insufficientEvidence).toBe(true);
    expect(result.limitations).toHaveLength(1);
    expect(result.answer).toBe(SAFE_INSUFFICIENT_EVIDENCE_ANSWER);
  });

  it("replaces model prose when no claim has a traceable evidence reference", () => {
    const result = new ClaimExtractionLayer().extract({
      answer: "This prose was not traced to the knowledge base.",
      claims: [
        {
          claim_text: "An unsupported claim.",
          claim_type: "fact",
          weight: 1,
          evidence: [],
        },
      ],
      limitations: [],
      insufficient_evidence: false,
    });

    expect(result.answer).toBe(SAFE_INSUFFICIENT_EVIDENCE_ANSWER);
    expect(result.insufficientEvidence).toBe(true);
    expect(result.claims).toHaveLength(1);
    expect(result.limitations).toContain("生成结果未包含可追溯到检索证据的 Claim。");
  });
});
