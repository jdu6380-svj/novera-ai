import { describe, expect, it } from "vitest";

import { evaluateCaseResult, type EvaluationExpectation } from "./scoring";

const expectedBase: EvaluationExpectation = {
  case_id: "case-test",
  question: "question",
  expected_answer: "expected value",
  answerability: "answerable",
  expected_behavior: "return the value",
  evidence_text: [{ document_id: "doc-001", evidence_text: "source evidence", evidence_location: "page 1" }],
};

function result(input: {
  answer?: string;
  insufficientEvidence?: boolean;
  retrievedEvidence?: boolean;
  validCount?: number;
  invalidCount?: number;
  unsupportedClaimCount?: number;
} = {}) {
  return {
    status: "EXECUTED",
    retrieval: {
      chunks: input.retrievedEvidence === false
        ? []
        : [{ document_id: "doc-001", text: "source evidence" }],
    },
    generation: {
      answer: {
        answer: input.answer ?? "expected value",
        insufficientEvidence: input.insufficientEvidence ?? false,
      },
    },
    evidence: {
      valid_count: input.validCount ?? 1,
      invalid_count: input.invalidCount ?? 0,
      unsupported_claim_count: input.unsupportedClaimCount ?? 0,
    },
  };
}

describe("fixed-corpus answerability scoring", () => {
  it("keeps the answer, evidence, and retrieval gates for answerable cases", () => {
    expect(evaluateCaseResult(result(), expectedBase).status).toBe("PASS");
    expect(evaluateCaseResult(result({ retrievedEvidence: false }), expectedBase).status).toBe("FAIL");
    expect(evaluateCaseResult(result({ answer: "different" }), expectedBase).status).toBe("FAIL");
  });

  it("normalizes Unicode punctuation without weakening exact evidence matching", () => {
    const punctuationCase = {
      ...expectedBase,
      evidence_text: [{
        document_id: "doc-001",
        evidence_text: "同月退货批次为 7 批，较 7 月减少 2 批。",
        evidence_location: "line 7",
      }],
    };
    const runResult = result({ answer: "expected value" });
    runResult.retrieval.chunks[0]!.text = "同月退货批次为 7 批,较 7 月减少 2 批.";
    expect(evaluateCaseResult(runResult, punctuationCase).expected_evidence_retrieved).toBe(true);

    runResult.retrieval.chunks[0]!.text = "同月退货批次为 7 批,较 8 月减少 2 批.";
    expect(evaluateCaseResult(runResult, punctuationCase).expected_evidence_retrieved).toBe(false);
  });

  it("accepts a grounded paraphrase of an unanswerable case only when it explicitly refuses", () => {
    const expected = {
      ...expectedBase,
      answerability: "unanswerable",
      expected_behavior: "identify missing evidence and do not guess",
      expected_answer: "The document does not provide a purchase budget.",
    };
    const scored = evaluateCaseResult(result({
      answer: "现有资料未提供采购预算金额，无法确定。",
      insufficientEvidence: true,
    }), expected);

    expect(scored.status).toBe("PASS");
    expect(scored.expected_answer_present).toBe(false);
    expect(scored.refusal_correct).toBe(true);
  });

  it("fails an unanswerable case when its explicit gap evidence is not retrieved", () => {
    const expected = { ...expectedBase, answerability: "unanswerable" };
    expect(evaluateCaseResult(result({
      answer: "資料未提供金額。",
      insufficientEvidence: true,
      retrievedEvidence: false,
    }), expected).status).toBe("FAIL");
  });

  it("requires a format-specific refusal instead of an answer from a frozen unsupported-format case", () => {
    const expected = {
      ...expectedBase,
      answerability: "answerable_in_source_format",
      expected_behavior: "reject the unsupported format",
    };
    expect(evaluateCaseResult(result({
      answer: "該格式不支持，請导出为 PDF 后重新上传。",
      insufficientEvidence: true,
      retrievedEvidence: false,
      validCount: 0,
    }), expected).status).toBe("PASS");
    expect(evaluateCaseResult(result({
      answer: "expected value",
      insufficientEvidence: false,
    }), expected).status).toBe("FAIL");
  });

  it("requires an OCR or manual-review boundary for image-only evidence", () => {
    const expected = {
      ...expectedBase,
      answerability: "requires_ocr_or_review",
      expected_behavior: "do not treat image text as parsed evidence",
    };
    expect(evaluateCaseResult(result({
      answer: "扫描页需要 OCR 或人工核对，当前不能确认该数值。",
      insufficientEvidence: true,
      retrievedEvidence: false,
      validCount: 0,
    }), expected).status).toBe("PASS");
    expect(evaluateCaseResult(result({
      answer: "expected value",
      insufficientEvidence: false,
    }), expected).status).toBe("FAIL");
  });

  it("fails all branches when the evidence verifier reports invalid or unsupported claims", () => {
    const expected = { ...expectedBase, answerability: "unanswerable" };
    expect(evaluateCaseResult(result({
      answer: "资料未提供金额。",
      insufficientEvidence: true,
      invalidCount: 1,
    }), expected).status).toBe("FAIL");
    expect(evaluateCaseResult(result({
      answer: "资料未提供金额。",
      insufficientEvidence: true,
      unsupportedClaimCount: 1,
    }), expected).status).toBe("FAIL");
  });
});
