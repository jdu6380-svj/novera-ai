import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";

import {
  DocxDocumentParser,
  ImageDocumentParser,
  MarkdownDocumentParser,
  ParserLayer,
  PdfDocumentParser,
  PlainTextDocumentParser,
  type DocumentProcessingSource,
} from "./parser";
import type { ImageOcrProvider, OcrResult } from "./image-ocr";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000010";

function source(
  content: string,
  overrides: Partial<DocumentProcessingSource> = {},
): DocumentProcessingSource {
  return {
    documentId: DOCUMENT_ID,
    displayName: "Product Notes",
    mimeType: "text/markdown",
    fileExtension: "md",
    metadata: { department: "product" },
    content: new TextEncoder().encode(content),
    ...overrides,
  };
}

function docxFixture(documentXml: string): Uint8Array {
  const filename = Buffer.from("word/document.xml", "utf8");
  const content = Buffer.from(documentXml, "utf8");
  const compressed = deflateRawSync(content);
  const localHeader = Buffer.alloc(30 + filename.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(content.length, 22);
  localHeader.writeUInt16LE(filename.length, 26);
  filename.copy(localHeader, 30);

  const centralHeader = Buffer.alloc(46 + filename.length);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(content.length, 24);
  centralHeader.writeUInt16LE(filename.length, 28);
  filename.copy(centralHeader, 46);

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralHeader.length, 12);
  endRecord.writeUInt32LE(localHeader.length + compressed.length, 16);

  return new Uint8Array(Buffer.concat([localHeader, compressed, centralHeader, endRecord]));
}

function fixedOcrResult(confidence = 92): OcrResult {
  const word = {
    text: "98.7%",
    confidence,
    bounds: { left: 200, top: 80, right: 280, bottom: 110 },
  };
  return {
    lines: [{
      text: "库存准确率 98.7%",
      confidence,
      minimumWordConfidence: confidence,
      bounds: word.bounds,
      words: [word],
    }],
    averageConfidence: confidence,
    minimumWordConfidence: confidence,
    wordCount: 1,
  };
}

function fixedOcrProvider(result = fixedOcrResult()): ImageOcrProvider {
  return { recognize: async () => result };
}

describe("Parser Layer", () => {
  it("parses Markdown headings, frontmatter, lists, and fenced code", async () => {
    const parsed = await new MarkdownDocumentParser().parse(
      source(`---\nauthor: Ada\nversion: 2\n---\n# Product Notes\n\n## Churn\n\nUsers are confused.\n\n- Missing next step\n- Slow checkout\n\n\`\`\`ts\nconst answer = 42;\n\`\`\``),
    );

    expect(parsed.title).toBe("Product Notes");
    expect(parsed.metadata.frontmatter).toEqual({ author: "Ada", version: 2 });
    expect(parsed.blocks.map((block) => block.kind)).toEqual([
      "heading",
      "heading",
      "paragraph",
      "list",
      "code",
    ]);
    expect(parsed.blocks[1]?.headingLevel).toBe(2);
    expect(parsed.blocks[4]?.metadata).toMatchObject({ language: "ts", closedFence: true });
    expect(parsed.blocks[1]?.locator.lineStart).toBe(7);
  });

  it("parses UTF-8 plain text into paragraph blocks", async () => {
    const parsed = await new PlainTextDocumentParser().parse(
      source("第一段\n\n第二段", {
        displayName: "Feedback",
        mimeType: "text/plain",
        fileExtension: "txt",
      }),
    );

    expect(parsed.blocks).toHaveLength(2);
    expect(parsed.blocks[0]?.text).toBe("第一段");
    expect(parsed.blocks[1]?.locator.lineStart).toBe(3);
    expect(parsed.charCount).toBe("第一段\n\n第二段".length);
  });

  it("parses DOCX XML from a ZIP archive", async () => {
    const parsed = await new DocxDocumentParser().parse(
      source(
        "ignored",
        {
          displayName: "实验报告",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          fileExtension: "docx",
          content: docxFixture(
            `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>产品分析实验</w:t></w:r></w:p><w:p><w:r><w:t>实验的核心目标是验证新流程。</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>实验组采用新方案</w:t></w:r></w:p></w:body></w:document>`,
          ),
        },
      ),
    );

    expect(parsed.title).toBe("产品分析实验");
    expect(parsed.blocks.map((block) => [block.kind, block.text])).toEqual([
      ["heading", "产品分析实验"],
      ["paragraph", "实验的核心目标是验证新流程。"],
      ["list", "实验组采用新方案"],
    ]);
    expect(parsed.parser.name).toBe("docx");
  });

  it("preserves DOCX table headers, rows, and column relationships", async () => {
    const parsed = await new DocxDocumentParser().parse(
      source("ignored", {
        displayName: "Table.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileExtension: "docx",
        content: docxFixture(
          `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Revenue</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>East</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42.6</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
        ),
      }),
    );

    expect(parsed.metadata.extractionWarnings).toBeUndefined();
    expect(parsed.blocks.map((block) => block.text)).toContain("Table 1 row 2: Region=East | Revenue=42.6");
    expect(parsed.blocks.find((block) => block.metadata.rowNumber === 2)?.metadata).toMatchObject({
      tableNumber: 1,
      rowNumber: 2,
      cells: ["East", "42.6"],
    });
  });

  it("requires review for DOCX merged cells that cannot be mapped consistently", async () => {
    const parsed = await new DocxDocumentParser().parse(
      source("ignored", {
        displayName: "Merged Table.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileExtension: "docx",
        content: docxFixture(
          `<w:document><w:body><w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Combined</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
        ),
      }),
    );
    expect(parsed.metadata.extractionWarnings).toEqual([
      expect.objectContaining({ code: "DOCX_TABLE_STRUCTURE_NOT_PRESERVED", severity: "review_required" }),
    ]);
  });

  it("preserves PDF page locators and metadata through the parser boundary", async () => {
    const parser = new PdfDocumentParser(async () => ({
      pageCount: 2,
      title: "Feedback Report",
      metadata: { author: "Ada" },
      pages: [
        { pageNumber: 1, text: "Customers cannot find the next step." },
        { pageNumber: 2, text: "Checkout is slow." },
      ],
    }));

    const parsed = await parser.parse(
      source("ignored", {
        displayName: "Feedback Report",
        mimeType: "application/pdf",
        fileExtension: "pdf",
      }),
    );

    expect(parsed.title).toBe("Feedback Report");
    expect(parsed.pageCount).toBe(2);
    expect(parsed.metadata).toEqual({ author: "Ada" });
    expect(parsed.blocks[0]?.locator.pageStart).toBe(1);
    expect(parsed.blocks[1]?.locator.pageStart).toBe(2);
  });

  it("flags PDF pages without extractable text for review", async () => {
    const parser = new PdfDocumentParser(async () => ({
      pageCount: 3,
      title: "Mixed Appendix",
      metadata: {},
      pages: [
        { pageNumber: 1, text: "Readable page" },
        { pageNumber: 2, text: "   " },
        { pageNumber: 3, text: "Another readable page" },
      ],
    }));

    const parsed = await parser.parse(
      source("ignored", {
        displayName: "Mixed Appendix",
        mimeType: "application/pdf",
        fileExtension: "pdf",
      }),
    );

    expect(parsed.blocks).toHaveLength(2);
    expect(parsed.metadata.extractionWarnings).toEqual([
      {
        code: "PAGE_HAS_NO_EXTRACTABLE_TEXT",
        pageNumber: 2,
        severity: "review_required",
        message: "This page has no extractable text and OCR could not render it. Upload a text-based or OCR-processed PDF.",
      },
    ]);
  });

  it("OCRs scanned PDF pages with page location and keeps a review recommendation non-blocking", async () => {
    const parser = new PdfDocumentParser(async () => ({
      pageCount: 1,
      title: "Scanned Inspection",
      metadata: {},
      pages: [{ pageNumber: 1, text: "", ocrImage: new Uint8Array([1, 2, 3]) }],
    }), fixedOcrProvider());
    const parsed = await parser.parse(source("ignored", {
      displayName: "Scanned Inspection.pdf",
      mimeType: "application/pdf",
      fileExtension: "pdf",
    }));

    expect(parsed.blocks[0]).toMatchObject({
      text: "库存准确率 98.7%",
      locator: { pageStart: 1, pageEnd: 1, lineStart: 1 },
      metadata: { extractionMethod: "tesseract-ocr", confidence: 92 },
    });
    expect(parsed.metadata.extractionWarnings).toEqual([
      expect.objectContaining({ code: "OCR_VISUAL_REVIEW_REQUIRED", severity: "notice", location: "Page 1" }),
    ]);
  });

  it("surfaces low-confidence OCR and routes handwriting to manual transcription", async () => {
    const parsed = await new ImageDocumentParser(fixedOcrProvider(fixedOcrResult(42))).parse(
      source("image bytes", {
        displayName: "inspection.png",
        mimeType: "image/png",
        fileExtension: "png",
      }),
    );

    expect(parsed.metadata.ocr).toMatchObject({
      engine: "tesseract.js",
      language: "chi_sim",
      minimumWordConfidence: 42,
    });
    expect(parsed.metadata.extractionWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "OCR_VISUAL_REVIEW_REQUIRED", severity: "notice" }),
      expect.objectContaining({ code: "OCR_LOW_CONFIDENCE", severity: "review_required" }),
    ]));
  });

  it("uses English OCR for a printed scan and preserves the exact page value", async () => {
    const content = new Uint8Array(await readFile(
      "evals/document-reliability/fixtures/03_yunhai_mixed_scan_appendix.pdf",
    ));
    const parsed = await new PdfDocumentParser().parse(source("", {
      displayName: "03_yunhai_mixed_scan_appendix.pdf",
      mimeType: "application/pdf",
      fileExtension: "pdf",
      content,
    }));
    const text = parsed.blocks.map((block) => block.text).join(" ");

    expect(text).toContain("2025 customer return rate was 1.6%.");
    expect(parsed.blocks).toContainEqual(expect.objectContaining({
      text: "2025 customer return rate was 1.6%.",
      locator: expect.objectContaining({ pageStart: 2, pageEnd: 2 }),
    }));
    expect(Array.isArray(parsed.metadata.extractionWarnings)).toBe(true);
    expect((parsed.metadata.extractionWarnings as Array<{ severity: string }>).some((warning) =>
      warning.severity === "review_required",
    )).toBe(false);
  }, 30_000);

  it("corroborates low-confidence scan values with focused OCR", async () => {
    const content = new Uint8Array(await readFile(
      "evals/document-reliability/fixtures/05_scanned_only_inspection.pdf",
    ));
    const parsed = await new PdfDocumentParser().parse(source("", {
      displayName: "05_scanned_only_inspection.pdf",
      mimeType: "application/pdf",
      fileExtension: "pdf",
      content,
    }));
    const text = parsed.blocks.map((block) => block.text).join(" ");
    const metadata = parsed.blocks.flatMap((block) => block.metadata.words as Array<{
      text: string;
      confidence: number;
      verificationMethod?: string;
    }>);

    expect(text).toContain("库存准确率为98.7%");
    expect(text).toContain("抽检样本为620件");
    expect(metadata).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "98.7%", confidence: 14, verificationMethod: "independent-numeric-crop-agreement" }),
    ]));
    expect((parsed.metadata.extractionWarnings as Array<{ severity: string }>).some((warning) =>
      warning.severity === "review_required",
    )).toBe(false);
  });

  it("extracts month-linked values from a printed horizontal bar chart", async () => {
    const content = new Uint8Array(await readFile(
      "evals/document-reliability/fixtures/20_factory_quality_chart.png",
    ));
    const parsed = await new ImageDocumentParser().parse(source("", {
      displayName: "20_factory_quality_chart.png",
      mimeType: "image/png",
      fileExtension: "png",
      content,
    }));
    const text = parsed.blocks.map((block) => block.text).join(" ");

    expect(text).toContain("2025年7月：98.4%");
    expect(text).toContain("2025年8月：99.1%");
    expect(parsed.blocks.some((block) => block.metadata.verificationMethod === "chart-label-linked-numeric-crop")).toBe(true);
    expect((parsed.metadata.extractionWarnings as Array<{ severity: string }>).some((warning) =>
      warning.severity === "review_required",
    )).toBe(false);
  });

  it("resolves the supported parser by document type", () => {
    const layer = new ParserLayer();
    expect(layer.resolve(source("text")).name).toBe("markdown");
    expect(
      layer.resolve(
        source("text", { mimeType: "application/pdf", fileExtension: "pdf" }),
      ).name,
    ).toBe("pdf-parse");
    expect(
      layer.resolve(source("text", { mimeType: "text/plain", fileExtension: "txt" })).name,
    ).toBe("plain-text");
    expect(
      layer.resolve(
        source("text", {
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          fileExtension: "docx",
        }),
      ).name,
    ).toBe("docx");
    expect(layer.resolve(source("", {
      fileExtension: "xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })).name).toBe("xlsx");
    expect(layer.resolve(source("", {
      fileExtension: "pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    })).name).toBe("pptx");
    expect(layer.resolve(source("", { fileExtension: "png", mimeType: "image/png" })).name).toBe("image-ocr");
    expect(layer.resolve(source("", { fileExtension: "jpeg", mimeType: "image/jpeg" })).name).toBe("image-ocr");
  });
});
