import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

type AcceptanceV3 = {
  schema_version: string;
  source_of_truth: Record<string, string>;
  documents: Array<{ document_id: string; v1_capability: string; v2_profile: string; v3_profile: string }>;
  cases: Array<{
    case_id: string;
    document_id: string;
    v1_answerability: string;
    standard: string;
    source_assertions?: string[];
    source_locators: string[];
    answer_equivalents?: string[];
  }>;
};

const root = path.resolve(process.cwd(), "evals/document-reliability");
const spec = JSON.parse(readFileSync(path.join(root, "corpus-spec.v1.json"), "utf8")) as {
  documents: Array<{ document_id: string; expected_capability: string; questions: Array<{ case_id: string; answerability: string }> }>;
};
const acceptance = JSON.parse(readFileSync(path.join(root, "acceptance.v3.json"), "utf8")) as AcceptanceV3;

function sha256(fileName: string): string {
  return createHash("sha256").update(readFileSync(path.join(root, fileName))).digest("hex");
}

describe("document reliability acceptance v3 mapping", () => {
  it("pins the immutable v1 source and original v2 acceptance", () => {
    for (const [fileKey, hashKey] of [
      ["corpus_spec", "corpus_spec_sha256"],
      ["manifest", "manifest_sha256"],
      ["actual_results", "actual_results_sha256"],
      ["original_full_run", "original_full_run_sha256"],
      ["parent_acceptance_v2", "parent_acceptance_v2_sha256"],
    ]) {
      expect(sha256(acceptance.source_of_truth[fileKey]!)).toBe(acceptance.source_of_truth[hashKey]);
    }
  });

  it("maps every fixed document and question exactly once without changing original identity", () => {
    const fixedCases = spec.documents.flatMap((document) => document.questions.map((question) => ({
      ...question,
      document_id: document.document_id,
    })));
    expect(acceptance.documents).toHaveLength(20);
    expect(new Set(acceptance.documents.map((item) => item.document_id)).size).toBe(20);
    expect(acceptance.cases).toHaveLength(40);
    expect(new Set(acceptance.cases.map((item) => item.case_id)).size).toBe(40);

    for (const document of acceptance.documents) {
      expect(spec.documents.find((source) => source.document_id === document.document_id)?.expected_capability)
        .toBe(document.v1_capability);
      expect(document.v3_profile).toBeTruthy();
    }
    for (const item of acceptance.cases) {
      const source = fixedCases.find((testCase) => testCase.case_id === item.case_id);
      expect(item.document_id).toBe(source?.document_id);
      expect(item.v1_answerability).toBe(source?.answerability);
      expect(item.source_locators.length).toBeGreaterThan(0);
    }
  });

  it("treats the five previously refused OCR cases as evidence-backed answers", () => {
    const byId = new Map(acceptance.cases.map((item) => [item.case_id, item]));
    const expectedDocuments = ["case-006", "case-009", "case-010", "case-039", "case-040"];
    for (const caseId of expectedDocuments) {
      expect(byId.get(caseId)?.standard).toBe("verified_ocr_answer");
      expect(byId.get(caseId)?.source_assertions?.length).toBeGreaterThan(0);
    }
    expect(byId.get("case-039")?.source_assertions).toEqual(["2025年8月：99.1%"]);
    expect(byId.get("case-040")?.source_assertions).toEqual(["2025年7月：98.4%", "2025年8月：99.1%"]);
    expect(byId.get("case-040")?.answer_equivalents).toContain("上升0.7个百分点");
  });
});
