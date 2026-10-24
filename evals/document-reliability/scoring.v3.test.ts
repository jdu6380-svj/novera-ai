import { describe, expect, it } from "vitest";

import { evaluateCaseResultV3, type V3CasePolicy } from "./scoring.v3";

const expected = {
  case_id: "case-039",
  question: "图表显示 2025 年 8 月的一次检验合格率是多少？",
  expected_answer: "99.1%（图片 OCR 未支持）",
  answerability: "answerable_in_source_format",
  expected_behavior: "回答并引用原图 OCR 来源",
  evidence_text: [{ document_id: "doc-020", evidence_text: "2025年8月：99.1%", evidence_location: "PNG image page 1" }],
};

const policy: V3CasePolicy = {
  case_id: "case-039",
  document_id: "doc-020",
  standard: "verified_ocr_answer",
  evidence_mode: "verified_ocr_quote_and_page_location",
  source_locators: ["PNG image page 1"],
  source_assertions: ["2025年8月：99.1%"],
  answer_equivalents: ["99.1%"],
};

function result(input: { confidence?: number; verificationMethod?: string; validCount?: number } = {}) {
  const confidence = input.confidence ?? 94;
  const verificationMethod = input.verificationMethod ?? "chart-label-linked-numeric-crop";
  return {
    status: "EXECUTED",
    retrieval: {
      chunks: [{
        document_id: "doc-020",
        text: "Page 1 一次检验合格率 2025年8月：99.1%",
        locator: { pageStart: 1, pageEnd: 1 },
        ocr_provenance: [{
          text: "2025年8月：99.1%",
          source_block_text: "2025年8月：99.1%",
          extraction_method: "tesseract-ocr",
          confidence,
          verification_method: verificationMethod,
          locator: { pageStart: 1, pageEnd: 1 },
          numeric_words: [{
            text: "99.1%",
            confidence: 40,
            effective_confidence: 94,
            verification_method: verificationMethod,
          }],
        }],
      }],
    },
    generation: { answer: { answer: "2025 年 8 月的一次检验合格率为 99.1%。", insufficientEvidence: false } },
    evidence: { valid_count: input.validCount ?? 1, invalid_count: 0, unsupported_claim_count: 0 },
  };
}

describe("answer-completion acceptance v3", () => {
  it("passes only a retrieved, cited, locator-bound chart OCR answer with crop provenance", () => {
    expect(evaluateCaseResultV3(result(), expected, policy)).toMatchObject({
      status: "PASS",
      criterion: "verified_ocr_answer",
      answer_matches_ground_truth: true,
      expected_evidence_retrieved: true,
      source_location_verified: true,
      evidence_valid: true,
      verified_ocr_provenance: true,
    });
  });

  it("rejects OCR without verified crop provenance even if its answer string matches", () => {
    expect(evaluateCaseResultV3(result({ verificationMethod: "" }), expected, policy).status).toBe("FAIL");
    expect(evaluateCaseResultV3(result({ confidence: 50 }), expected, policy).status).toBe("FAIL");
  });

  it("requires the actual evidence verification result", () => {
    expect(evaluateCaseResultV3(result({ validCount: 0 }), expected, policy).status).toBe("FAIL");
  });
});
