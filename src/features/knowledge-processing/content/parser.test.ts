import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";

import {
  DocxDocumentParser,
  MarkdownDocumentParser,
  ParserLayer,
  PdfDocumentParser,
  PlainTextDocumentParser,
  type DocumentProcessingSource,
} from "./parser";

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
  });
});
