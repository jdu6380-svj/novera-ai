import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { JsonObject } from "../../src/domain";
import {
  ParserLayer,
  type DocumentProcessingSource,
} from "../../src/features/knowledge-processing/content/parser";

type Manifest = {
  documents: Array<{
    document_id: string;
    file_name: string;
    file_format: string;
    mime_type: string;
    document_hash: string;
    expected_capability: string;
    expected_behavior: string;
    known_limitations: string[];
    execution_status?: string;
    actual_behavior?: string;
  }>;
  cases: Array<Record<string, unknown> & { case_id: string }>;
};

const ROOT = path.resolve(process.cwd(), "evals/document-reliability");
const FIXTURES = path.join(ROOT, "fixtures");
const MANIFEST = path.join(ROOT, "manifest.v1.json");

function sourceFor(document: Manifest["documents"][number], content: Uint8Array): DocumentProcessingSource {
  return {
    documentId: document.document_id,
    displayName: document.file_name,
    mimeType: document.mime_type,
    fileExtension: path.extname(document.file_name).slice(1),
    metadata: { sourceType: "synthetic" },
    content,
  };
}

describe("Document reliability corpus", () => {
  it("evaluates all 20 real fixtures without network or model calls", async () => {
    const manifest = JSON.parse(await readFile(MANIFEST, "utf8")) as Manifest;
    expect(manifest.documents).toHaveLength(20);
    expect(manifest.cases).toHaveLength(40);
    expect(new Set(manifest.documents.map((document) => document.document_id)).size).toBe(20);
    expect(new Set(manifest.cases.map((item) => item.case_id)).size).toBe(40);

    const parserLayer = new ParserLayer();
    const results: Array<Record<string, unknown>> = [];
    const extractedText = new Map<string, string>();

    for (const document of manifest.documents) {
      const content = new Uint8Array(await readFile(path.join(FIXTURES, document.file_name)));
      expect(createHash("sha256").update(content).digest("hex")).toBe(document.document_hash);
      const source = sourceFor(document, content);
      const parsed = await parserLayer.parse(source);
      const warnings = parsed.metadata.extractionWarnings;
      const warningList = Array.isArray(warnings) ? warnings.filter((item): item is JsonObject =>
        typeof item === "object" && item !== null && !Array.isArray(item),
      ) : [];
      const reviewRequired = warningList.some((item) => item.severity === "review_required");
      extractedText.set(document.document_id, parsed.blocks.map((block) => block.text).join("\n"));
      results.push({
        document_id: document.document_id,
        file_name: document.file_name,
        parser: parsed.parser,
        execution_status: reviewRequired ? "PARTIAL" : "PASS",
        actual_behavior: reviewRequired
          ? "Content parsed, but one or more extraction warnings require review."
          : warningList.length > 0
            ? `Parsed ${parsed.blocks.length} content blocks with a non-blocking extraction notice.`
            : `Parsed ${parsed.blocks.length} content blocks without a parser warning.`,
        page_count: parsed.pageCount,
        char_count: parsed.charCount,
        warning_count: warningList.length,
        warnings: warningList,
      });
    }

    const byId = new Map(results.map((result) => [result.document_id, result]));
    expect(byId.get("doc-003")).toMatchObject({ execution_status: "PASS" });
    expect(byId.get("doc-003")?.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "OCR_VISUAL_REVIEW_REQUIRED", severity: "notice" }),
    ]));
    expect(extractedText.get("doc-003")).toContain("2025 customer return rate was 1.6%.");
    expect(byId.get("doc-005")).toMatchObject({ execution_status: "PASS" });
    expect(extractedText.get("doc-005")).toContain("库存准确率为98.7%");
    expect(extractedText.get("doc-005")).toContain("抽检样本为620件");
    expect(byId.get("doc-007")).toMatchObject({ execution_status: "PASS" });
    for (const id of ["doc-016", "doc-017"]) {
      expect(byId.get(id)).toMatchObject({ execution_status: "PASS" });
    }
    for (const id of ["doc-018", "doc-019"]) {
      expect(byId.get(id)).toMatchObject({ execution_status: "PARTIAL" });
    }
    expect(byId.get("doc-020")).toMatchObject({ execution_status: "PASS" });
    expect(byId.get("doc-020")?.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "OCR_VISUAL_REVIEW_REQUIRED", severity: "notice" }),
    ]));
    expect(extractedText.get("doc-020")).toContain("2025年7月：98.4%");
    expect(extractedText.get("doc-020")).toContain("2025年8月：99.1%");

    const caseResults = manifest.cases.map((item) => {
      const evidence = item.evidence_text as Array<{ document_id: string; evidence_text: string; evidence_location: string }>;
      const evidenceMissing = evidence.filter((sourceEvidence) =>
        !extractedText.get(sourceEvidence.document_id)?.includes(sourceEvidence.evidence_text),
      );
      const documentsForCase = [item.document_id as string, ...((item.related_document_ids as string[] | undefined) ?? [])];
      const documentResults = documentsForCase.map((id) => byId.get(id));
      const unsupported = documentResults.some((result) => result?.execution_status === "UNSUPPORTED");
      const reviewRequired = documentResults.some((result) => result?.execution_status === "PARTIAL") || evidenceMissing.length > 0;
      if (!unsupported && !reviewRequired) {
        expect(evidenceMissing, `${item.case_id as string} evidence must be preserved by the parser`).toHaveLength(0);
      }
      const status = unsupported
        ? "UNSUPPORTED_RAG_NOT_EXECUTED"
        : reviewRequired
          ? "REVIEW_REQUIRED_RAG_NOT_EXECUTED"
          : evidenceMissing.length === 0
            ? "PARSER_EVIDENCE_PRESENT_RAG_NOT_EXECUTED"
            : "EVIDENCE_NOT_EXTRACTED_RAG_NOT_EXECUTED";
      const actualResult = unsupported
        ? "The parser rejected this format; the question was not passed to retrieval or answer generation."
        : evidenceMissing.length > 0
          ? `One or more expected evidence snippets were not extracted: ${evidenceMissing.map((entry) => entry.evidence_location).join(", ")}.`
          : "Expected evidence text is present in parser output; retrieval and answer generation were not run.";
      return {
        ...item,
        actual_result: actualResult,
        verification_status: status,
      };
    });

    expect(results).toHaveLength(20);
    expect(caseResults).toHaveLength(40);
    expect(results.reduce<Record<string, number>>((counts, item) => {
      const status = String(item.execution_status);
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    }, {})).toEqual({ PASS: 18, PARTIAL: 2 });
    expect(caseResults.reduce<Record<string, number>>((counts, item) => {
      const status = String(item.verification_status);
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    }, {})).toEqual({
      PARSER_EVIDENCE_PRESENT_RAG_NOT_EXECUTED: 27,
      REVIEW_REQUIRED_RAG_NOT_EXECUTED: 13,
    });
    const casesById = new Map(caseResults.map((item) => [item.case_id, item]));
    for (const caseId of ["case-031", "case-032", "case-033", "case-034"]) {
      expect(casesById.get(caseId)).toMatchObject({
        verification_status: "REVIEW_REQUIRED_RAG_NOT_EXECUTED",
      });
    }
  }, 30_000);
});
