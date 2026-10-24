import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

type Spec = {
  documents: Array<{
    document_id: string;
    expected_capability: string;
    questions: Array<{
      case_id: string;
      answerability: string;
      evidence: Array<{ document_id: string; evidence_text: string; evidence_location: string }>;
    }>;
  }>;
};

type BaselineRun = {
  documents: Array<{
    document_id: string;
    extracted_text: Array<{
      text: string;
      locator: Record<string, unknown>;
      metadata: Record<string, unknown>;
    }>;
    chunks: Array<{ text: string; retrieval_eligible: boolean; locator: Record<string, unknown> }>;
    warnings: Array<{ code: string; location: string; severity: string }>;
  }>;
};

type AcceptanceV2 = {
  source_of_truth: Record<string, string>;
  standards: Record<string, unknown>;
  documents: Array<{
    document_id: string;
    v1_capability: string;
    v2_profile: string;
  }>;
  cases: Array<{
    case_id: string;
    document_id: string;
    v1_answerability: string;
    standard: string;
    evidence_mode: string;
    source_locators: string[];
    source_assertions?: string[];
    answer_equivalents?: string[];
    blocked_source?: { document_id: string; page: number };
  }>;
};

const root = path.resolve(process.cwd(), "evals/document-reliability");
const spec = JSON.parse(readFileSync(path.join(root, "corpus-spec.v1.json"), "utf8")) as Spec;
const acceptance = JSON.parse(readFileSync(path.join(root, "acceptance.v2.json"), "utf8")) as AcceptanceV2;
const baseline = JSON.parse(readFileSync(path.join(root, acceptance.source_of_truth.original_full_run), "utf8")) as BaselineRun;

function sha256(fileName: string): string {
  return createHash("sha256").update(readFileSync(path.join(root, fileName))).digest("hex");
}

function compact(value: string): string {
  return value.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
}

describe("document reliability acceptance v2 mapping", () => {
  it("pins the immutable v1 source artifacts", () => {
    expect(sha256(acceptance.source_of_truth.corpus_spec)).toBe(acceptance.source_of_truth.corpus_spec_sha256);
    expect(sha256(acceptance.source_of_truth.manifest)).toBe(acceptance.source_of_truth.manifest_sha256);
    expect(sha256(acceptance.source_of_truth.actual_results)).toBe(acceptance.source_of_truth.actual_results_sha256);
    expect(sha256(acceptance.source_of_truth.original_full_run)).toBe(acceptance.source_of_truth.original_full_run_sha256);
  });

  it("maps every original document exactly once without changing its v1 capability", () => {
    expect(acceptance.documents.map((item) => item.document_id).sort()).toEqual(
      spec.documents.map((item) => item.document_id).sort(),
    );

    for (const mapping of acceptance.documents) {
      const source = spec.documents.find((document) => document.document_id === mapping.document_id);
      expect(source?.expected_capability).toBe(mapping.v1_capability);
      expect(mapping.v2_profile).toBeTruthy();
    }
  });

  it("maps every original case exactly once to the same v1 document and answerability", () => {
    const sourceCases = spec.documents.flatMap((document) =>
      document.questions.map((question) => ({
        ...question,
        document_id: document.document_id,
      })),
    );
    const mappedIds = acceptance.cases.map((item) => item.case_id);

    expect(mappedIds).toHaveLength(40);
    expect(new Set(mappedIds).size).toBe(40);
    expect(mappedIds.sort()).toEqual(sourceCases.map((item) => item.case_id).sort());

    for (const mapping of acceptance.cases) {
      const source = sourceCases.find((item) => item.case_id === mapping.case_id);
      expect(mapping.document_id).toBe(source?.document_id);
      expect(mapping.v1_answerability).toBe(source?.answerability);
      expect(acceptance.standards[mapping.standard as keyof typeof acceptance.standards]).toBeTruthy();
      expect(mapping.evidence_mode).toBeTruthy();
      expect(mapping.source_locators).toHaveLength(source?.evidence.length ?? -1);
    }
  });

  it("keeps formerly unsupported structured formats distinct from review-required OCR", () => {
    const byId = new Map(acceptance.cases.map((item) => [item.case_id, item]));

    for (const caseId of ["case-031", "case-032", "case-033", "case-034"]) {
      expect(byId.get(caseId)?.standard).toBe("xlsx_structured_row_answer");
    }
    for (const caseId of ["case-035", "case-036", "case-037", "case-038"]) {
      expect(byId.get(caseId)?.standard).toBe("pptx_slide_text_answer");
    }
    for (const caseId of ["case-039", "case-040"]) {
      expect(byId.get(caseId)?.standard).toBe("review_required_ocr_refusal");
    }
    for (const caseId of ["case-031", "case-032", "case-033", "case-034", "case-035", "case-036", "case-037", "case-038"]) {
      expect(byId.get(caseId)?.source_assertions?.length).toBeGreaterThan(0);
    }
    expect(byId.get("case-001")?.answer_equivalents).toContain("1.284 亿元");
    expect(byId.get("case-007")?.answer_equivalents).toContain("5,400 单位");
    expect(byId.get("case-002")?.answer_equivalents).toContain("增加了 10.8 百万元");
    expect(byId.get("case-002")?.answer_equivalents).toContain("增加了 1,080 万元");
    expect(byId.get("case-014")?.answer_equivalents).toContain("31.8 百万元");
    expect(byId.get("case-021")?.answer_equivalents).toContain("1.284 亿元");
    expect(byId.get("case-026")?.answer_equivalents).toContain("未报告夜班单独产量");
    expect(byId.get("case-034")?.answer_equivalents).toContain("OCR 前人工复核");
    expect(byId.get("case-007")?.answer_equivalents).toContain("5,400 个单位");
    expect(byId.get("case-008")?.answer_equivalents).toContain("未给出设备采购预算金额");
    expect(byId.get("case-018")?.answer_equivalents).toContain("研发预算金额未在所提供的文档中披露");
    expect(byId.get("case-024")?.answer_equivalents).toContain("未披露净收入留存率");
    expect(byId.get("case-030")?.answer_equivalents).toContain("不含海外经销商订单");
  });

  it("maps v2 source requirements to real parser blocks, locators, and eligibility from the pinned run", () => {
    const sourceCases = spec.documents.flatMap((document) =>
      document.questions.map((question) => ({ ...question, document_id: document.document_id })),
    );
    const baselineDocuments = new Map(baseline.documents.map((document) => [document.document_id, document]));

    for (const policy of acceptance.cases) {
      const sourceCase = sourceCases.find((item) => item.case_id === policy.case_id);
      const sourceDocument = baselineDocuments.get(policy.document_id);
      expect(sourceCase).toBeTruthy();
      expect(sourceDocument).toBeTruthy();
      if (!sourceCase || !sourceDocument) continue;

      if (policy.standard === "review_required_ocr_refusal") {
        expect(policy.blocked_source?.document_id).toBe(policy.document_id);
        expect(sourceDocument.warnings.some((warning) => warning.severity === "review_required")).toBe(true);
        const blockedPage = policy.blocked_source?.page;
        expect(sourceDocument.chunks.some((chunk) => {
          const start = typeof chunk.locator.pageStart === "number" ? chunk.locator.pageStart : null;
          const end = typeof chunk.locator.pageEnd === "number" ? chunk.locator.pageEnd : start;
          return chunk.retrieval_eligible && blockedPage !== undefined && start !== null && end !== null && start <= blockedPage && end >= blockedPage;
        })).toBe(false);
        continue;
      }

      const allParserBlocks = sourceDocument.extracted_text;
      if (policy.source_assertions) {
        for (const assertion of policy.source_assertions) {
          expect(allParserBlocks.some((block) => compact(block.text).includes(compact(assertion))), `${policy.case_id}: ${assertion}`).toBe(true);
        }
      }

      if (policy.standard === "grounded_answer" || policy.standard === "information_gap_refusal" || policy.standard === "docx_structured_row_answer") {
        for (const [index, evidence] of sourceCase.evidence.entries()) {
          const expectedLocator = policy.source_locators[index] ?? "";
          const evidenceDocument = baselineDocuments.get(evidence.document_id);
          expect(evidenceDocument).toBeTruthy();
          const evidenceBlocks = evidenceDocument?.extracted_text ?? [];
          const sourceBlock = evidenceBlocks.find((block) => compact(block.text).includes(compact(evidence.evidence_text)));
          expect(sourceBlock, `${policy.case_id}: ${evidence.document_id} ${evidence.evidence_text}`).toBeTruthy();
          if (!sourceBlock) continue;
          const page = expectedLocator.match(/PDF page (\d+)/iu);
          const sourceLine = expectedLocator.match(/source line (\d+)/iu);
          const line = expectedLocator.match(/(?:Markdown|TXT)(?: table)? lines? (\d+)(?:-(\d+))?/iu);
          if (page?.[1]) {
            expect(Number(sourceBlock.locator.pageStart)).toBe(Number(page[1]));
            expect(Number(sourceBlock.locator.pageEnd)).toBe(Number(page[1]));
          }
          const start = sourceLine?.[1] ? Number(sourceLine[1]) : line?.[1] ? Number(line[1]) : null;
          const end = line?.[2] ? Number(line[2]) : start;
          if (start !== null && end !== null) {
            const lineStart = Number(sourceBlock.locator.lineStart);
            const lineEnd = Number(sourceBlock.locator.lineEnd);
            expect(lineStart).toBeLessThanOrEqual(end);
            expect(lineEnd).toBeGreaterThanOrEqual(start);
          }
          if (expectedLocator.includes("Table 1 row")) {
            expect(sourceBlock.text).toContain("Table 1 row 3:");
          }
        }
      }

      if (policy.standard === "xlsx_structured_row_answer") {
        const locator = policy.source_locators[0] ?? "";
        const row = Number(locator.match(/physical row (\d+)/iu)?.[1]);
        expect(allParserBlocks.some((block) => block.metadata.rowNumber === row && policy.source_assertions?.every((assertion) =>
          compact(block.text).includes(compact(assertion)),
        ))).toBe(true);
      } else if (policy.standard === "pptx_slide_text_answer") {
        const slide = Number(policy.source_locators[0]?.match(/slide (\d+)/iu)?.[1]);
        expect(allParserBlocks.some((block) => block.locator.pageStart === slide && block.metadata.chartPath === undefined &&
          policy.source_assertions?.every((assertion) => compact(block.text).includes(compact(assertion))),
        )).toBe(true);
      }
    }
  });
});
