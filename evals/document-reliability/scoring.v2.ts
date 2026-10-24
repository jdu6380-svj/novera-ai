type RecordValue = Record<string, unknown>;

export type V2Expectation = {
  case_id: string;
  question: string;
  expected_answer: string;
  answerability: string;
  expected_behavior: string;
  evidence_text: Array<{
    document_id: string;
    evidence_text: string;
    evidence_location: string;
  }>;
};

export type V2CasePolicy = {
  case_id: string;
  document_id: string;
  standard: string;
  evidence_mode: string;
  source_locators: string[];
  source_assertions?: string[];
  answer_equivalents?: string[];
  blocked_source?: { document_id: string; page: number };
  forbidden_answer_values?: string[];
};

function record(value: unknown): RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : {};
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[\s\p{P}\p{S}]/gu, "");
}

function retrievedChunks(result: RecordValue): RecordValue[] {
  const retrieval = record(result.retrieval);
  return Array.isArray(retrieval.chunks) ? retrieval.chunks.map(record) : [];
}

function hasInformationGapSignal(answer: string): boolean {
  return /未提供|未列出|未披露|未说明|未给出|没有|缺少|无法确定|无法回答|not\s+(?:provided|listed|disclosed|available)|does\s+not\s+provide|cannot\s+(?:answer|determine)/iu.test(answer);
}

function hasOcrReviewSignal(answer: string): boolean {
  return /ocr|扫描|掃描|图像|圖像|图片|圖片|人工核对|人工核對|人工录入|人工錄入|无法读取|無法讀取|复核/u.test(answer);
}

function locatorMatches(expected: string, chunk: RecordValue): boolean {
  const locator = record(chunk.locator);
  const text = typeof chunk.text === "string" ? chunk.text : "";
  const lineStart = typeof locator.lineStart === "number" ? locator.lineStart : null;
  const lineEnd = typeof locator.lineEnd === "number" ? locator.lineEnd : lineStart;
  const pageStart = typeof locator.pageStart === "number" ? locator.pageStart : null;
  const pageEnd = typeof locator.pageEnd === "number" ? locator.pageEnd : pageStart;

  const row = expected.match(/physical row (\d+)/iu);
  if (row?.[1]) {
    return /Worksheet\s*:?\s*数据/iu.test(text) && new RegExp(`Row ${row[1]}:`).test(text);
  }

  const slide = expected.match(/slide (\d+)/iu);
  if (slide?.[1]) {
    return pageStart === Number(slide[1]) && pageEnd === Number(slide[1]) && !/^\s*Chart\b/u.test(text);
  }

  const pdfPage = expected.match(/PDF page (\d+)/iu);
  if (pdfPage?.[1]) {
    const page = Number(pdfPage[1]);
    return pageStart !== null && pageEnd !== null && pageStart <= page && pageEnd >= page;
  }

  const sourceLine = expected.match(/source line (\d+)/iu);
  const markdownLines = expected.match(/(?:Markdown|TXT)(?: table)? lines? (\d+)(?:-(\d+))?/iu);
  const line = sourceLine?.[1] ? Number(sourceLine[1]) : markdownLines?.[1] ? Number(markdownLines[1]) : null;
  const end = markdownLines?.[2] ? Number(markdownLines[2]) : line;
  if (line !== null && lineStart !== null && lineEnd !== null && end !== null) {
    const containsLine = lineStart <= end && lineEnd >= line;
    if (!containsLine) return false;
    const tableRow = expected.match(/Table 1 row (\d+)/iu);
    return !tableRow || text.includes(`Table 1 row ${tableRow[1]}:`);
  }

  return false;
}

function exactEvidenceRetrieved(
  chunks: RecordValue[],
  expected: V2Expectation,
  policy: V2CasePolicy,
): boolean {
  return expected.evidence_text.every((evidence, index) => chunks.some((chunk) =>
    chunk.document_id === evidence.document_id &&
    typeof chunk.text === "string" &&
    normalize(chunk.text).includes(normalize(evidence.evidence_text)) &&
    locatorMatches(policy.source_locators[index] ?? evidence.evidence_location, chunk),
  ));
}

function structuredAssertionsRetrieved(chunks: RecordValue[], policy: V2CasePolicy): boolean {
  const assertions = policy.source_assertions ?? [];
  if (assertions.length === 0) return false;
  return chunks.some((chunk) => {
    if (chunk.document_id !== policy.document_id || typeof chunk.text !== "string") return false;
    const normalizedText = normalize(chunk.text);
    const hasAssertions = assertions.every((assertion) => normalizedText.includes(normalize(assertion)));
    const locatorValid = policy.source_locators.some((locator) => locatorMatches(locator, chunk));
    const slideSourceAllowed = policy.standard !== "pptx_slide_text_answer" || !/^\s*Chart\b/u.test(chunk.text);
    return hasAssertions && locatorValid && slideSourceAllowed;
  });
}

function locationBoundaryRespected(chunks: RecordValue[], policy: V2CasePolicy): boolean {
  const blocked = policy.blocked_source;
  if (!blocked) return false;
  return !chunks.some((chunk) => {
    if (chunk.document_id !== blocked.document_id) return false;
    const locator = record(chunk.locator);
    const start = typeof locator.pageStart === "number" ? locator.pageStart : null;
    const end = typeof locator.pageEnd === "number" ? locator.pageEnd : start;
    return start !== null && end !== null && start <= blocked.page && end >= blocked.page;
  });
}

export function evaluateCaseResultV2(
  result: RecordValue,
  expected: V2Expectation,
  policy: V2CasePolicy,
): RecordValue {
  const chunks = retrievedChunks(result);
  const generation = record(result.generation);
  const answer = record(generation.answer);
  const answerText = typeof answer.answer === "string" ? answer.answer : "";
  const evidence = record(result.evidence);
  const validCount = Number(evidence.valid_count) || 0;
  const invalidCount = Number(evidence.invalid_count) || 0;
  const unsupportedClaimCount = Number(evidence.unsupported_claim_count) || 0;
  const evidenceIntegritySafe = invalidCount === 0 && unsupportedClaimCount === 0 && result.status === "EXECUTED";
  const evidenceValid = validCount > 0 && evidenceIntegritySafe;
  const answerForms = [expected.expected_answer, ...(policy.answer_equivalents ?? [])];
  const matchedAnswerForm = answerForms.find((form) => normalize(answerText).includes(normalize(form))) ?? null;
  const answerMatchesGroundTruth = matchedAnswerForm !== null;
  const insufficientEvidence = answer.insufficientEvidence === true;

  let evidenceRetrieved = false;
  let sourceRequirementSatisfied = false;
  let locationVerified = false;
  let decisionCorrect = false;
  let evidenceGate = false;
  const criterion = policy.standard;

  if (policy.standard === "grounded_answer" || policy.standard === "information_gap_refusal") {
    evidenceRetrieved = exactEvidenceRetrieved(chunks, expected, policy);
    locationVerified = evidenceRetrieved;
    sourceRequirementSatisfied = evidenceRetrieved;
    if (policy.standard === "grounded_answer") {
      decisionCorrect = answerMatchesGroundTruth && !insufficientEvidence;
      evidenceGate = evidenceValid;
    } else {
      decisionCorrect = insufficientEvidence && hasInformationGapSignal(answerText);
      evidenceGate = evidenceValid;
    }
  } else if (policy.standard === "review_required_ocr_refusal") {
    evidenceRetrieved = false;
    locationVerified = locationBoundaryRespected(chunks, policy);
    sourceRequirementSatisfied = locationVerified;
    const containsForbiddenValue = (policy.forbidden_answer_values ?? []).some((value) =>
      normalize(answerText).includes(normalize(value)),
    );
    decisionCorrect = insufficientEvidence && hasOcrReviewSignal(answerText) && !containsForbiddenValue;
    evidenceGate = evidenceIntegritySafe;
  } else {
    evidenceRetrieved = structuredAssertionsRetrieved(chunks, policy);
    locationVerified = evidenceRetrieved;
    sourceRequirementSatisfied = evidenceRetrieved;
    decisionCorrect = answerMatchesGroundTruth && !insufficientEvidence;
    evidenceGate = evidenceValid;
  }

  const passed = decisionCorrect && sourceRequirementSatisfied && locationVerified && evidenceGate;
  return {
    status: passed ? "PASS" : result.status === "EXECUTED" ? "FAIL" : "UNVERIFIED",
    criterion,
    expected_answerability: expected.answerability,
    expected_behavior: expected.expected_behavior,
    expected_answer: expected.expected_answer,
    answer_matches_ground_truth: answerMatchesGroundTruth,
    matched_answer_form: matchedAnswerForm,
    expected_evidence_retrieved: evidenceRetrieved,
    source_requirement_satisfied: sourceRequirementSatisfied,
    source_location_verified: locationVerified,
    evidence_valid: evidenceValid,
    evidence_integrity_safe: evidenceIntegritySafe,
    decision_correct: decisionCorrect,
    review_boundary_respected: policy.standard === "review_required_ocr_refusal" ? locationVerified : null,
    source_assertions: policy.source_assertions ?? [],
    source_locators: policy.source_locators,
  };
}
