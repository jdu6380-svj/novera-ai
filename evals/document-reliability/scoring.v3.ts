import { evaluateCaseResultV2, type V2Expectation } from "./scoring.v2";
import type { V2CasePolicy } from "./scoring.v2";

type RecordValue = Record<string, unknown>;

export type V3CasePolicy = V2CasePolicy;

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

function locatorMatches(expected: string, chunk: RecordValue): boolean {
  const locator = record(chunk.locator);
  const pageStart = typeof locator.pageStart === "number" ? locator.pageStart : null;
  const pageEnd = typeof locator.pageEnd === "number" ? locator.pageEnd : pageStart;

  const pdfPage = expected.match(/PDF page (\d+)/iu);
  if (pdfPage?.[1]) {
    const page = Number(pdfPage[1]);
    return pageStart !== null && pageEnd !== null && pageStart <= page && pageEnd >= page;
  }

  const imagePage = expected.match(/PNG image page (\d+)/iu);
  if (imagePage?.[1]) {
    const page = Number(imagePage[1]);
    return pageStart === page && pageEnd === page;
  }

  return false;
}

function sourceSegments(chunk: RecordValue): RecordValue[] {
  return Array.isArray(chunk.ocr_provenance)
    ? chunk.ocr_provenance.map(record)
    : [];
}

function sourceSegmentSupportsAssertion(
  segment: RecordValue,
  assertion: string,
): boolean {
  const sourceText = typeof segment.text === "string" ? segment.text : "";
  const sourceBlockText = typeof segment.source_block_text === "string"
    ? segment.source_block_text
    : "";
  if (!normalize(`${sourceText} ${sourceBlockText}`).includes(normalize(assertion))) return false;
  if (segment.extraction_method !== "tesseract-ocr") return false;
  const lineConfidence = typeof segment.confidence === "number" ? segment.confidence : 0;

  const assertionNumbers = assertion.match(/\d+(?:\.\d+)?%?/gu) ?? [];
  const relevantNumbers = assertionNumbers.filter((value) => !/^20\d{2}$/u.test(value));
  if (relevantNumbers.length === 0) return lineConfidence >= 85;
  if (lineConfidence < 60) return false;

  const words = Array.isArray(segment.numeric_words)
    ? segment.numeric_words.map(record)
    : [];
  const segmentMethod = typeof segment.verification_method === "string"
    ? segment.verification_method
    : null;

  return relevantNumbers.every((expectedNumber) => {
    const matchingWord = words.find((word) => typeof word.text === "string" &&
      normalize(word.text).includes(normalize(expectedNumber)),
    );
    if (!matchingWord) {
      // Some Tesseract layouts expose the verified number at line level only.
      // This is accepted only for high-confidence lines or the chart-specific crop pass.
      return lineConfidence >= 90 || segmentMethod === "chart-label-linked-numeric-crop";
    }
    const rawConfidence = typeof matchingWord.confidence === "number" ? matchingWord.confidence : 0;
    const effectiveConfidence = typeof matchingWord.effective_confidence === "number"
      ? matchingWord.effective_confidence
      : rawConfidence;
    if (effectiveConfidence < 60) return false;
    if (rawConfidence >= 60) return true;
    const wordMethod = typeof matchingWord.verification_method === "string"
      ? matchingWord.verification_method
      : segmentMethod;
    return wordMethod === "independent-numeric-crop-agreement" ||
      wordMethod === "chart-label-linked-numeric-crop";
  });
}

function verifiedOcrAssertionsRetrieved(
  chunks: RecordValue[],
  expected: V2Expectation,
  policy: V3CasePolicy,
): boolean {
  const assertions = policy.source_assertions ?? [];
  if (assertions.length === 0) return false;
  return assertions.every((assertion, index) => chunks.some((chunk) => {
    if (chunk.document_id !== policy.document_id ||
        typeof chunk.text !== "string" ||
        !normalize(chunk.text).includes(normalize(assertion)) ||
        !locatorMatches(policy.source_locators[index] ?? expected.evidence_text[index]?.evidence_location ?? "", chunk)) {
      return false;
    }
    return sourceSegments(chunk).some((segment) =>
      sourceSegmentSupportsAssertion(segment, assertion) &&
      locatorMatches(policy.source_locators[index] ?? "", { locator: segment.locator }),
    );
  }));
}

export function evaluateCaseResultV3(
  result: RecordValue,
  expected: V2Expectation,
  policy: V3CasePolicy,
): RecordValue {
  if (policy.standard !== "verified_ocr_answer") {
    return evaluateCaseResultV2(result, expected, policy);
  }

  const chunks = retrievedChunks(result);
  const generation = record(result.generation);
  const answer = record(generation.answer);
  const answerText = typeof answer.answer === "string" ? answer.answer : "";
  const forms = [expected.expected_answer, ...(policy.answer_equivalents ?? [])];
  const matchedAnswerForm = forms.find((form) => normalize(answerText).includes(normalize(form))) ?? null;
  const evidence = record(result.evidence);
  const validCount = Number(evidence.valid_count) || 0;
  const invalidCount = Number(evidence.invalid_count) || 0;
  const unsupportedClaimCount = Number(evidence.unsupported_claim_count) || 0;
  const evidenceIntegritySafe = invalidCount === 0 && unsupportedClaimCount === 0 && result.status === "EXECUTED";
  const evidenceValid = validCount > 0 && evidenceIntegritySafe;
  const assertionsRetrieved = verifiedOcrAssertionsRetrieved(chunks, expected, policy);
  const passed = matchedAnswerForm !== null &&
    answer.insufficientEvidence !== true &&
    assertionsRetrieved &&
    evidenceValid;

  return {
    status: passed ? "PASS" : result.status === "EXECUTED" ? "FAIL" : "UNVERIFIED",
    criterion: "verified_ocr_answer",
    expected_answerability: expected.answerability,
    expected_behavior: expected.expected_behavior,
    expected_answer: expected.expected_answer,
    answer_matches_ground_truth: matchedAnswerForm !== null,
    matched_answer_form: matchedAnswerForm,
    expected_evidence_retrieved: assertionsRetrieved,
    source_requirement_satisfied: assertionsRetrieved,
    source_location_verified: assertionsRetrieved,
    evidence_valid: evidenceValid,
    evidence_integrity_safe: evidenceIntegritySafe,
    decision_correct: matchedAnswerForm !== null && answer.insufficientEvidence !== true,
    verified_ocr_provenance: assertionsRetrieved,
    source_assertions: policy.source_assertions ?? [],
    source_locators: policy.source_locators,
  };
}
