import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import type { DocumentProcessingSource } from "./parser";
import { ParserLayer } from "./parser";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000010";

async function source(filename: string, mimeType: string): Promise<DocumentProcessingSource> {
  return {
    documentId: DOCUMENT_ID,
    displayName: filename,
    mimeType,
    fileExtension: filename.split(".").pop() ?? "",
    metadata: {},
    content: new Uint8Array(
      await readFile(new URL(`../../../../evals/document-reliability/fixtures/${filename}`, import.meta.url)),
    ),
  };
}

describe("Office Open XML parsers", () => {
  it.each([
    {
      filename: "16_revenue_by_region.xlsx",
      expectedHeader: "营业收入（百万元）",
      expectedValue: "区域=华东",
    },
    {
      filename: "17_risk_register.xlsx",
      expectedHeader: "措施",
      expectedValue: "风险=极端天气延误",
    },
  ])("extracts workbook rows, headers, and source coordinates from $filename", async ({
    filename,
    expectedHeader,
    expectedValue,
  }) => {
    const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const input = await source(filename, mimeType);
    const parsed = await new ParserLayer().parse(input);

    expect(parsed.parser.name).toBe("xlsx");
    expect(parsed.metadata).toMatchObject({ worksheetCount: 1, visibleWorksheetCount: 1 });
    expect(parsed.blocks.some((block) => block.text.includes(expectedHeader))).toBe(true);
    expect(parsed.blocks.some((block) => block.text.includes(expectedValue))).toBe(true);
    expect(parsed.blocks.find((block) => block.metadata.rowNumber === 4)?.locator.lineStart).toBe(4);
  });

  it.each([
    "18_quarterly_strategy.pptx",
    "19_capacity_review.pptx",
  ])("extracts slide text, chart cache values, and slide locators from %s", async (filename) => {
    const parsed = await new ParserLayer().parse(await source(
      filename,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ));

    expect(parsed.parser.name).toBe("pptx");
    expect(parsed.pageCount).toBe(2);
    expect(parsed.blocks.some((block) => block.metadata.slideNumber === 1 && block.kind === "heading")).toBe(true);
    expect(parsed.blocks.some((block) => block.text.includes("目标：") || block.text.includes("日均处理量："))).toBe(true);
    expect(parsed.blocks.some((block) => block.metadata.cachedChartData === true && block.text.includes("="))).toBe(true);
    expect(parsed.metadata.extractionWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PPTX_CHART_CACHE_USED", severity: "review_required" }),
    ]));
    expect(parsed.metadata.extractionWarnings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PPTX_CHART_CACHE_UNAVAILABLE" }),
    ]));
    expect(parsed.blocks.every((block) => block.locator.startChar !== null && block.locator.endChar !== null)).toBe(true);
    expect(parsed.blocks.every((block) => block.locator.endChar === (block.locator.startChar ?? 0) + block.text.length)).toBe(true);
  });
});
