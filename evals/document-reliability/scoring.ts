type EvidenceExpectation = {
  document_id: string;
  evidence_text: string;
  evidence_location: string;
};

export type EvaluationExpectation = {
  case_id: string;
  question: string;
  expected_answer: string;
  answerability: string;
  expected_behavior: string;
  evidence_text: EvidenceExpectation[];
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : {};
}

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase("en-US");
}

function normalizedEvidence(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u3001\u3002\uFF0C\uFF1B\uFF1A\uFF01\uFF1F]/gu, (punctuation) => ({
      "\u3001": ",",
      "\u3002": ".",
      "\uFF0C": ",",
      "\uFF1B": ";",
      "\uFF1A": ":",
      "\uFF01": "!",
      "\uFF1F": "?",
    })[punctuation] ?? punctuation)
    .replace(/\s+/gu, "");
}

function hasInformationGapSignal(answer: string): boolean {
  return /未提供|未列出|未披露|沒有|没有|缺少|無法確定|无法确定|無法回答|无法回答|not\s+(?:provided|listed|disclosed|available)|does\s+not\s+provide|cannot\s+(?:answer|determine)/iu.test(answer);
}

function hasOcrBoundarySignal(answer: string): boolean {
  return /ocr|掃描|扫描|圖像|图像|圖片|图片|人工核對|人工核对|人工錄入|人工录入|無法讀取|无法读取/iu.test(answer);
}

function hasUnsupportedFormatSignal(answer: string): boolean {
  return /不支持|不支援|無法處理|无法处理|無法讀取|无法读取|導出|导出|另存|複製文本|复制文本|格式未支持/iu.test(answer);
}

export function evaluateCaseResult(
  result: RecordValue,
  expected: EvaluationExpectation,
): RecordValue {
  const retrieval = record(result.retrieval);
  const chunks = Array.isArray(retrieval.chunks) ? retrieval.chunks.map(record) : [];
  const generation = record(result.generation);
  const answer = record(generation.answer);
  const evidence = record(result.evidence);
  const answerText = typeof answer.answer === "string" ? answer.answer : "";
  const expectedAnswerPresent = normalized(answerText).includes(normalized(expected.expected_answer));
  const expectedEvidenceRetrieved = expected.evidence_text.every((item) => chunks.some((chunk) =>
    chunk.document_id === item.document_id &&
    typeof chunk.text === "string" &&
    normalizedEvidence(chunk.text).includes(normalizedEvidence(item.evidence_text)),
  ));
  const validCount = Number(evidence.valid_count) || 0;
  const invalidCount = Number(evidence.invalid_count) || 0;
  const unsupportedClaimCount = Number(evidence.unsupported_claim_count) || 0;
  const evidenceIntegritySafe = invalidCount === 0 && unsupportedClaimCount === 0;
  const evidenceValid = validCount > 0 && evidenceIntegritySafe;
  const insufficientEvidence = answer.insufficientEvidence === true;

  let refusalExpected = false;
  let refusalCorrect: boolean | null = null;
  let criterion: string;
  let passed: boolean;

  if (expected.answerability === "unanswerable") {
    refusalExpected = true;
    refusalCorrect = insufficientEvidence &&
      hasInformationGapSignal(answerText) &&
      expectedEvidenceRetrieved &&
      evidenceValid;
    criterion = "explicit_refusal_with_retrieved_gap_evidence";
    passed = refusalCorrect;
  } else if (expected.answerability === "requires_ocr_or_review") {
    refusalExpected = true;
    refusalCorrect = insufficientEvidence &&
      hasOcrBoundarySignal(answerText) &&
      !expectedEvidenceRetrieved &&
      evidenceIntegritySafe;
    criterion = "ocr_or_manual_review_boundary_refusal";
    passed = refusalCorrect;
  } else if (expected.answerability === "answerable_in_source_format") {
    refusalExpected = true;
    refusalCorrect = insufficientEvidence &&
      hasUnsupportedFormatSignal(answerText) &&
      !expectedEvidenceRetrieved &&
      evidenceIntegritySafe;
    criterion = "unsupported_source_format_refusal";
    passed = refusalCorrect;
  } else {
    criterion = "ground_truth_answer_and_evidence_match";
    passed = expectedAnswerPresent && evidenceValid && expectedEvidenceRetrieved;
  }

  return {
    status: passed ? "PASS" : "FAIL",
    criterion,
    expected_answerability: expected.answerability,
    expected_behavior: expected.expected_behavior,
    expected_answer: expected.expected_answer,
    expected_answer_present: expectedAnswerPresent,
    expected_evidence_retrieved: expectedEvidenceRetrieved,
    evidence_valid: evidenceValid,
    evidence_integrity_safe: evidenceIntegritySafe,
    refusal_expected: refusalExpected,
    refusal_correct: refusalCorrect,
    expected_evidence_locations: expected.evidence_text.map((item) => item.evidence_location),
  };
}
