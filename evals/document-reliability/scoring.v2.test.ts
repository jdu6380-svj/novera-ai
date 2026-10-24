import { describe, expect, it } from "vitest";

import { evaluateCaseResultV2, type V2CasePolicy, type V2Expectation } from "./scoring.v2";

const answerExpectation: V2Expectation = {
  case_id: "case-test",
  question: "What was the revenue?",
  expected_answer: "42.6 million yuan",
  answerability: "answerable",
  expected_behavior: "give value and source",
  evidence_text: [{ document_id: "doc-001", evidence_text: "Revenue was 42.6 million yuan.", evidence_location: "PDF page 1" }],
};

const answerPolicy: V2CasePolicy = {
  case_id: "case-test",
  document_id: "doc-001",
  standard: "grounded_answer",
  evidence_mode: "v1_quote_and_location",
  source_locators: ["PDF page 1"],
};

function answerResult(input: {
  answer?: string;
  insufficientEvidence?: boolean;
  chunks?: Array<Record<string, unknown>>;
  validCount?: number;
  invalidCount?: number;
  unsupportedClaimCount?: number;
} = {}) {
  return {
    status: "EXECUTED",
    retrieval: {
      chunks: input.chunks ?? [{
        document_id: "doc-001",
        text: "Page 1 Revenue was 42.6 million yuan.",
        locator: { pageStart: 1, pageEnd: 1, lineStart: 1, lineEnd: 1 },
      }],
    },
    generation: {
      answer: {
        answer: input.answer ?? "Revenue was 42.6 million yuan.",
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

describe("acceptance v2 result scoring", () => {
  it("requires fixed answer, retrieved quote, correct source locator, and valid Evidence", () => {
    expect(evaluateCaseResultV2(answerResult(), answerExpectation, answerPolicy).status).toBe("PASS");
    const wrongPage = answerResult({
      chunks: [{ document_id: "doc-001", text: "Revenue was 42.6 million yuan.", locator: { pageStart: 2, pageEnd: 2 } }],
    });
    expect(evaluateCaseResultV2(wrongPage, answerExpectation, answerPolicy).status).toBe("FAIL");
    expect(evaluateCaseResultV2(answerResult({ invalidCount: 1 }), answerExpectation, answerPolicy).status).toBe("FAIL");
  });

  it("requires a structured row to preserve workbook headers, values, and physical location", () => {
    const expected = {
      ...answerExpectation,
      expected_answer: "42.6 百万元",
      evidence_text: [],
    };
    const policy: V2CasePolicy = {
      ...answerPolicy,
      standard: "xlsx_structured_row_answer",
      evidence_mode: "xlsx_header_and_row",
      source_assertions: ["区域=华东", "年份=2025", "收入(百万元)=42.6"],
      source_locators: ["Worksheet 数据, physical row 4"],
    };
    const result = answerResult({
      answer: "华东区 2025 年收入为 42.6 百万元。",
      chunks: [{
        document_id: "doc-001",
        text: "Worksheet: 数据 > Headers: 区域 | 年份 | 收入(百万元)\n\nRow 4: 区域=华东 | 年份=2025 | 收入(百万元)=42.6",
        locator: { sectionPath: "Worksheet 数据", lineStart: 1, lineEnd: 2 },
      }],
    });
    expect(evaluateCaseResultV2(result, expected, policy).status).toBe("PASS");
    const bareCell = answerResult({
      answer: "42.6 百万元",
      chunks: [{ document_id: "doc-001", text: "42.6", locator: { sectionPath: "Worksheet 数据", lineStart: 1 } }],
    });
    expect(evaluateCaseResultV2(bareCell, expected, policy).status).toBe("FAIL");
  });

  it("accepts a localized information-gap refusal only with the mapped source evidence", () => {
    const expected: V2Expectation = {
      ...answerExpectation,
      expected_answer: "The notes do not provide an equipment purchase budget.",
      answerability: "unanswerable",
      evidence_text: [{
        document_id: "doc-004",
        evidence_text: "The notes do not provide an equipment purchase budget.",
        evidence_location: "PDF page 1",
      }],
    };
    const policy: V2CasePolicy = {
      ...answerPolicy,
      case_id: "case-008",
      document_id: "doc-004",
      standard: "information_gap_refusal",
      source_locators: ["PDF page 1"],
      answer_equivalents: ["未给出设备采购预算金额"],
    };
    const citedRefusal = answerResult({
      answer: "当前提供的证据未给出设备采购预算金额。",
      insufficientEvidence: true,
      chunks: [{
        document_id: "doc-004",
        text: "Page 1 The notes do not provide an equipment purchase budget.",
        locator: { pageStart: 1, pageEnd: 1 },
      }],
    });
    expect(evaluateCaseResultV2(citedRefusal, expected, policy).status).toBe("PASS");

    const wrongSource = answerResult({
      answer: "当前提供的证据未给出设备采购预算金额。",
      insufficientEvidence: true,
      chunks: [{
        document_id: "doc-009",
        text: "This summary does not list an R&D budget.",
        locator: { pageStart: 1, pageEnd: 1 },
      }],
    });
    expect(evaluateCaseResultV2(wrongSource, expected, policy).status).toBe("FAIL");
  });

  it("accepts an OCR-boundary refusal only when the blocked page is not retrieved", () => {
    const expected = {
      ...answerExpectation,
      expected_answer: "99.1% (OCR not verified)",
      answerability: "requires_ocr_or_review",
      evidence_text: [{ document_id: "doc-020", evidence_text: "99.1%", evidence_location: "PNG image" }],
    };
    const policy: V2CasePolicy = {
      ...answerPolicy,
      document_id: "doc-020",
      standard: "review_required_ocr_refusal",
      evidence_mode: "exclude_review_required_ocr",
      source_locators: ["PNG image page 1; low-confidence OCR excluded"],
      blocked_source: { document_id: "doc-020", page: 1 },
      forbidden_answer_values: ["99.1%"],
    };
    const refusal = answerResult({
      answer: "图片 OCR 置信度不足，需要人工复核，暂不报告数值。",
      insufficientEvidence: true,
      validCount: 0,
      chunks: [],
    });
    expect(evaluateCaseResultV2(refusal, expected, policy).status).toBe("PASS");

    const hallucinatedValue = answerResult({
      answer: "图片 OCR 置信度不足，需要人工复核，当前可能是 99.1%。",
      insufficientEvidence: true,
      validCount: 0,
      chunks: [],
    });
    expect(evaluateCaseResultV2(hallucinatedValue, expected, policy).status).toBe("FAIL");

    const leakedChunk = answerResult({
      answer: "图片 OCR 置信度不足，需要人工复核。",
      insufficientEvidence: true,
      validCount: 0,
      chunks: [{ document_id: "doc-020", text: "Page 1 OCR says 99.1%", locator: { pageStart: 1, pageEnd: 1 } }],
    });
    expect(evaluateCaseResultV2(leakedChunk, expected, policy).status).toBe("FAIL");
  });

  it("accepts only explicitly mapped equivalent wording while preserving the fixed value", () => {
    const expected = { ...answerExpectation, expected_answer: "5,400 units" };
    const policy = { ...answerPolicy, answer_equivalents: ["5,400 单位"] };
    expect(evaluateCaseResultV2(answerResult({ answer: "目标为 5,400单位。" }), expected, policy).status).toBe("PASS");
    expect(evaluateCaseResultV2(answerResult({ answer: "目标为 5,000单位。" }), expected, policy).status).toBe("FAIL");
  });
});
