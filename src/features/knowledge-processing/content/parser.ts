import type { JsonObject, JsonValue, UUID } from "@/domain";
import { inflateRawSync } from "node:zlib";
import {
  TesseractChineseOcrProvider,
  type ImageOcrProvider,
  type OcrResult,
} from "./image-ocr";

export const PARSED_BLOCK_KINDS = [
  "heading",
  "paragraph",
  "list",
  "code",
] as const;

export type ParsedBlockKind = (typeof PARSED_BLOCK_KINDS)[number];

/**
 * Character offsets are half-open and refer to the parser's decoded/extracted
 * text representation. PDF page numbers and line numbers are one-based.
 */
export interface SourceLocator {
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  startChar: number | null;
  endChar: number | null;
}

export interface DocumentProcessingSource {
  documentId: UUID;
  displayName: string;
  mimeType: string;
  fileExtension: string;
  metadata: JsonObject;
  content: Uint8Array;
}

export interface ParsedSourceDocument {
  documentId: UUID;
  displayName: string;
  mimeType: string;
  fileExtension: string;
  metadata: JsonObject;
}

export interface ParsedContentBlock {
  id: string;
  kind: ParsedBlockKind;
  text: string;
  headingLevel: number | null;
  locator: SourceLocator;
  metadata: JsonObject;
}

export interface ParsedDocument {
  source: ParsedSourceDocument;
  title: string | null;
  metadata: JsonObject;
  parser: {
    name: string;
    version: string;
  };
  blocks: ParsedContentBlock[];
  pageCount: number | null;
  charCount: number;
}

export type DocumentParsingErrorCode =
  | "UNSUPPORTED_DOCUMENT_TYPE"
  | "INVALID_TEXT_ENCODING"
  | "EMPTY_DOCUMENT"
  | "PDF_PARSE_FAILED"
  | "DOCX_PARSE_FAILED"
  | "XLSX_PARSE_FAILED"
  | "PPTX_PARSE_FAILED"
  | "IMAGE_PARSE_FAILED"
  | "OCR_FAILED";

export class DocumentParsingError extends Error {
  readonly cause: unknown;

  constructor(
    readonly code: DocumentParsingErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "DocumentParsingError";
    this.cause = cause;
  }
}

export interface ContentParser {
  readonly name: string;
  readonly version: string;

  supports(source: DocumentProcessingSource): boolean;
  parse(source: DocumentProcessingSource): Promise<ParsedDocument>;
}

interface ScannedLine {
  text: string;
  start: number;
  end: number;
  lineNumber: number;
}

interface UnnumberedBlock {
  kind: ParsedBlockKind;
  text: string;
  headingLevel: number | null;
  locator: SourceLocator;
  metadata: JsonObject;
}

function sourceDescriptor(source: DocumentProcessingSource): ParsedSourceDocument {
  return {
    documentId: source.documentId,
    displayName: source.displayName,
    mimeType: source.mimeType,
    fileExtension: source.fileExtension,
    metadata: source.metadata,
  };
}

function normalizeExtension(extension: string): string {
  return extension.trim().toLocaleLowerCase("en-US").replace(/^\./, "");
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US") ?? "";
}

function decodeUtf8(content: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch (error) {
    throw new DocumentParsingError(
      "INVALID_TEXT_ENCODING",
      "The document is not valid UTF-8 text.",
      error,
    );
  }
}

function scanLines(text: string): ScannedLine[] {
  const lines: ScannedLine[] = [];
  const newlinePattern = /\r\n|\n|\r/g;
  let start = 0;
  let lineNumber = 1;

  for (const match of text.matchAll(newlinePattern)) {
    const end = match.index;
    lines.push({
      text: text.slice(start, end),
      start,
      end,
      lineNumber,
    });
    start = end + match[0].length;
    lineNumber += 1;
  }

  if (start < text.length || lines.length === 0) {
    lines.push({
      text: text.slice(start),
      start,
      end: text.length,
      lineNumber,
    });
  }

  return lines;
}

function numberBlocks(blocks: readonly UnnumberedBlock[]): ParsedContentBlock[] {
  return blocks.map((block, index) => ({
    ...block,
    id: `block-${String(index).padStart(4, "0")}`,
  }));
}

function plainTextBlocks(
  text: string,
  options: {
    pageNumber?: number;
    charOffset?: number;
    lineOffset?: number;
  } = {},
): UnnumberedBlock[] {
  const lines = scanLines(text);
  const blocks: UnnumberedBlock[] = [];
  const pageNumber = options.pageNumber ?? null;
  const charOffset = options.charOffset ?? 0;
  const lineOffset = options.lineOffset ?? 0;
  let paragraphStart: number | null = null;

  const flushParagraph = (endIndex: number) => {
    if (paragraphStart === null || endIndex < paragraphStart) {
      return;
    }

    const firstLine = lines[paragraphStart];
    const lastLine = lines[endIndex];

    if (!firstLine || !lastLine) {
      return;
    }

    const blockText = text.slice(firstLine.start, lastLine.end);

    if (!blockText.trim()) {
      paragraphStart = null;
      return;
    }

    blocks.push({
      kind: "paragraph",
      text: blockText,
      headingLevel: null,
      locator: {
        pageStart: pageNumber,
        pageEnd: pageNumber,
        lineStart: firstLine.lineNumber + lineOffset,
        lineEnd: lastLine.lineNumber + lineOffset,
        startChar: firstLine.start + charOffset,
        endChar: lastLine.end + charOffset,
      },
      metadata: {},
    });
    paragraphStart = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line) {
      continue;
    }

    if (!line.text.trim()) {
      flushParagraph(index - 1);
      continue;
    }

    paragraphStart ??= index;
  }

  flushParagraph(lines.length - 1);
  return blocks;
}

const MIN_OCR_AVERAGE_CONFIDENCE = 85;
const MIN_OCR_WORD_CONFIDENCE = 60;

function ocrBlocks(
  result: OcrResult,
  options: { pageNumber: number; charOffset: number },
): UnnumberedBlock[] {
  let charOffset = options.charOffset;
  return result.lines.map((line, index) => {
    const startChar = charOffset;
    charOffset += line.text.length + 1;
    return {
      kind: "paragraph",
      text: line.text,
      headingLevel: null,
      locator: {
        pageStart: options.pageNumber,
        pageEnd: options.pageNumber,
        lineStart: index + 1,
        lineEnd: index + 1,
        startChar,
        endChar: startChar + line.text.length,
      },
      metadata: {
        extractionMethod: "tesseract-ocr",
        rawText: line.rawText ?? line.text,
        confidence: line.confidence,
        minimumWordConfidence: line.minimumWordConfidence,
        ...(line.verificationMethod ? { verificationMethod: line.verificationMethod } : {}),
        bounds: toJsonValue(line.bounds),
        words: toJsonValue(line.words.map((word) => ({
          text: word.text,
          confidence: word.confidence,
          effectiveConfidence: word.effectiveConfidence ?? word.confidence,
          ...(word.secondaryConfidence === undefined ? {} : { secondaryConfidence: word.secondaryConfidence }),
          ...(word.verificationMethod ? { verificationMethod: word.verificationMethod } : {}),
          bounds: word.bounds,
        }))),
      },
    };
  });
}

function ocrReviewWarning(result: OcrResult, location: string): JsonObject {
  return {
    code: "OCR_VISUAL_REVIEW_REQUIRED",
    severity: "notice",
    location,
    message: `OCR was applied with average raw word confidence ${Math.round(result.averageConfidence)}%. Handwritten content is not supported.`,
  };
}

function ocrConfidenceWarning(result: OcrResult, location: string): JsonObject | null {
  const effectiveAverageConfidence = result.effectiveAverageConfidence ?? result.averageConfidence;
  const effectiveMinimumWordConfidence = result.effectiveMinimumWordConfidence ?? result.minimumWordConfidence;
  if (
    effectiveAverageConfidence >= MIN_OCR_AVERAGE_CONFIDENCE &&
    effectiveMinimumWordConfidence >= MIN_OCR_WORD_CONFIDENCE
  ) {
    return null;
  }
  return {
    code: "OCR_LOW_CONFIDENCE",
    severity: "review_required",
    location,
    message: `OCR confidence is below the acceptance threshold (effective average ${Math.round(effectiveAverageConfidence)}%, raw minimum word ${Math.round(result.minimumWordConfidence)}%). Verify the affected values against the original.`,
  };
}

function assertHasContent(blocks: readonly UnnumberedBlock[]): void {
  if (!blocks.some((block) => block.text.trim().length > 0)) {
    throw new DocumentParsingError(
      "EMPTY_DOCUMENT",
      "The document does not contain extractable text.",
    );
  }
}

export class PlainTextDocumentParser implements ContentParser {
  readonly name = "plain-text";
  readonly version = "1.0.0";

  supports(source: DocumentProcessingSource): boolean {
    return (
      normalizeExtension(source.fileExtension) === "txt" ||
      normalizeMimeType(source.mimeType) === "text/plain"
    );
  }

  async parse(source: DocumentProcessingSource): Promise<ParsedDocument> {
    const text = decodeUtf8(source.content);
    const blocks = plainTextBlocks(text);
    assertHasContent(blocks);

    return {
      source: sourceDescriptor(source),
      title: null,
      metadata: {},
      parser: { name: this.name, version: this.version },
      blocks: numberBlocks(blocks),
      pageCount: null,
      charCount: text.length,
    };
  }
}

function parseFrontmatterValue(value: string): JsonValue {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (trimmed === "null" || trimmed === "~") {
    return null;
  }

  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    const numberValue = Number(trimmed);

    if (Number.isFinite(numberValue)) {
      return numberValue;
    }
  }

  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return toJsonValue(parsed);
    } catch {
      // Preserve unsupported YAML syntax as text instead of dropping metadata.
    }
  }

  return trimmed;
}

function parseFlatFrontmatter(raw: string): JsonObject {
  const metadata: JsonObject = {};

  for (const line of raw.split(/\r\n|\n|\r/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();

    if (key) {
      metadata[key] = parseFrontmatterValue(line.slice(separatorIndex + 1));
    }
  }

  return metadata;
}

function atxHeading(line: string): { level: number; text: string } | null {
  const match = line.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/);

  if (!match?.[1] || !match[2]) {
    return null;
  }

  const text = match[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
  return text ? { level: match[1].length, text } : null;
}

function setextLevel(line: string): number | null {
  if (/^[ \t]{0,3}=+[ \t]*$/.test(line)) {
    return 1;
  }

  if (/^[ \t]{0,3}-+[ \t]*$/.test(line)) {
    return 2;
  }

  return null;
}

function fenceOpening(line: string): { marker: string; language: string } | null {
  const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^ \t`]*)?.*$/);

  if (!match?.[1]) {
    return null;
  }

  return {
    marker: match[1],
    language: match[2]?.trim() ?? "",
  };
}

function isFenceClosing(line: string, marker: string): boolean {
  const markerCharacter = marker[0];

  if (!markerCharacter) {
    return false;
  }

  const match = line.match(/^[ \t]{0,3}(`+|~+)[ \t]*$/);
  return Boolean(
    match?.[1] &&
      match[1][0] === markerCharacter &&
      match[1].length >= marker.length,
  );
}

function isListLine(line: string): boolean {
  return /^[ \t]{0,3}(?:[-+*]|\d+[.)])[ \t]+/.test(line);
}

function markdownBlocks(text: string): {
  blocks: UnnumberedBlock[];
  metadata: JsonObject;
  title: string | null;
} {
  const lines = scanLines(text);
  const blocks: UnnumberedBlock[] = [];
  const metadata: JsonObject = {};
  let title: string | null = null;
  let index = 0;

  if (lines[0]?.text.trim() === "---") {
    const closingIndex = lines.findIndex(
      (line, candidateIndex) =>
        candidateIndex > 0 &&
        (line.text.trim() === "---" || line.text.trim() === "..."),
    );

    if (closingIndex > 0) {
      const firstMetadataLine = lines[1];
      const lastMetadataLine = lines[closingIndex - 1];
      const raw =
        firstMetadataLine && lastMetadataLine
          ? text.slice(firstMetadataLine.start, lastMetadataLine.end)
          : "";
      metadata.frontmatter = parseFlatFrontmatter(raw);
      metadata.frontmatterRaw = raw;
      index = closingIndex + 1;
    }
  }

  const makeLocator = (firstLine: ScannedLine, lastLine: ScannedLine): SourceLocator => ({
    pageStart: null,
    pageEnd: null,
    lineStart: firstLine.lineNumber,
    lineEnd: lastLine.lineNumber,
    startChar: firstLine.start,
    endChar: lastLine.end,
  });

  while (index < lines.length) {
    const line = lines[index];

    if (!line) {
      index += 1;
      continue;
    }

    if (!line.text.trim()) {
      index += 1;
      continue;
    }

    const atx = atxHeading(line.text);

    if (atx) {
      title ??= atx.level === 1 ? atx.text : null;
      blocks.push({
        kind: "heading",
        text: atx.text,
        headingLevel: atx.level,
        locator: makeLocator(line, line),
        metadata: {},
      });
      index += 1;
      continue;
    }

    const followingLine = lines[index + 1];
    const setext = followingLine ? setextLevel(followingLine.text) : null;

    if (setext && line.text.trim()) {
      const headingText = line.text.trim();
      title ??= setext === 1 ? headingText : null;
      blocks.push({
        kind: "heading",
        text: headingText,
        headingLevel: setext,
        locator: makeLocator(line, followingLine),
        metadata: { syntax: "setext" },
      });
      index += 2;
      continue;
    }

    const fence = fenceOpening(line.text);

    if (fence) {
      let closingIndex = index + 1;

      while (
        closingIndex < lines.length &&
        !isFenceClosing(lines[closingIndex]?.text ?? "", fence.marker)
      ) {
        closingIndex += 1;
      }

      const hasClosingFence = closingIndex < lines.length;
      const lastLine = lines[hasClosingFence ? closingIndex : lines.length - 1] ?? line;
      const codeLines = lines.slice(index + 1, hasClosingFence ? closingIndex : lines.length);
      blocks.push({
        kind: "code",
        text: codeLines.map((codeLine) => codeLine.text).join("\n"),
        headingLevel: null,
        locator: makeLocator(line, lastLine),
        metadata: {
          language: fence.language || null,
          closedFence: hasClosingFence,
        },
      });
      index = hasClosingFence ? closingIndex + 1 : lines.length;
      continue;
    }

    const list = isListLine(line.text);
    let endIndex = index;

    while (endIndex + 1 < lines.length) {
      const candidateIndex = endIndex + 1;
      const candidate = lines[candidateIndex];

      if (!candidate || !candidate.text.trim()) {
        break;
      }

      if (
        atxHeading(candidate.text) ||
        fenceOpening(candidate.text) ||
        (lines[candidateIndex + 1] && setextLevel(lines[candidateIndex + 1]?.text ?? ""))
      ) {
        break;
      }

      if (list !== isListLine(candidate.text) && isListLine(candidate.text)) {
        break;
      }

      endIndex = candidateIndex;
    }

    const lastLine = lines[endIndex] ?? line;
    blocks.push({
      kind: list ? "list" : "paragraph",
      text: text.slice(line.start, lastLine.end),
      headingLevel: null,
      locator: makeLocator(line, lastLine),
      metadata: {},
    });
    index = endIndex + 1;
  }

  return { blocks, metadata, title };
}

export class MarkdownDocumentParser implements ContentParser {
  readonly name = "markdown";
  readonly version = "1.0.0";

  supports(source: DocumentProcessingSource): boolean {
    const extension = normalizeExtension(source.fileExtension);
    return (
      extension === "md" ||
      extension === "markdown" ||
      normalizeMimeType(source.mimeType) === "text/markdown"
    );
  }

  async parse(source: DocumentProcessingSource): Promise<ParsedDocument> {
    const text = decodeUtf8(source.content);
    const result = markdownBlocks(text);
    assertHasContent(result.blocks);

    return {
      source: sourceDescriptor(source),
      title: result.title,
      metadata: result.metadata,
      parser: { name: this.name, version: this.version },
      blocks: numberBlocks(result.blocks),
      pageCount: null,
      charCount: text.length,
    };
  }
}

const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;

function decodeXmlText(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (entity, token: string) => {
      const normalized = token.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";
      const codePoint = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    },
  );
}

function zipEntry(content: Uint8Array, targetName: string): Uint8Array {
  const bytes = Buffer.from(content);
  const minimumEndRecordOffset = Math.max(0, bytes.length - 0xffff - 22);
  let endRecordOffset = -1;

  for (let offset = bytes.length - 22; offset >= minimumEndRecordOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      endRecordOffset = offset;
      break;
    }
  }

  if (endRecordOffset < 0) {
    throw new Error("The DOCX archive has no central directory.");
  }

  const entryCount = bytes.readUInt16LE(endRecordOffset + 10);
  const centralDirectorySize = bytes.readUInt32LE(endRecordOffset + 12);
  const centralDirectoryOffset = bytes.readUInt32LE(endRecordOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount && offset < centralDirectoryEnd; index += 1) {
    if (bytes.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_ENTRY) {
      throw new Error("The DOCX archive contains an invalid central directory entry.");
    }

    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const filenameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const filename = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + filenameLength));
    const nextOffset = offset + 46 + filenameLength + extraLength + commentLength;

    if (filename === targetName) {
      if (bytes.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER) {
        throw new Error("The DOCX archive contains an invalid local file header.");
      }

      const localFilenameLength = bytes.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFilenameLength + localExtraLength;
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        return new Uint8Array(compressed);
      }

      if (compressionMethod === 8) {
        return new Uint8Array(inflateRawSync(compressed));
      }

      throw new Error(`Unsupported ZIP compression method ${compressionMethod}.`);
    }

    offset = nextOffset;
  }

  throw new Error(`The DOCX archive does not contain ${targetName}.`);
}

function parseDocxParagraphs(xml: string): Array<{ text: string; kind: ParsedBlockKind; headingLevel: number | null }> {
  const paragraphs: Array<{ text: string; kind: ParsedBlockKind; headingLevel: number | null }> = [];

  for (const match of xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/gi)) {
    const paragraphXml = match[1] ?? "";
    const text = Array.from(paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gi))
      .map((textMatch) => decodeXmlText(textMatch[1] ?? ""))
      .join("")
      .replace(/\s+$/g, "")
      .trim();

    if (!text) continue;

    const paragraphProperties = paragraphXml.match(/<w:pPr(?:\s[^>]*)?>([\s\S]*?)<\/w:pPr>/i)?.[1] ?? "";
    const style = paragraphProperties.match(/<w:pStyle(?:\s[^>]*)?\s+w:val=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1] ?? "";
    const headingMatch = style.match(/heading\s*([1-6])/i);
    const headingLevel = headingMatch?.[1] ? Number(headingMatch[1]) : null;
    const isList = /<w:numPr(?:\s[^>]*)?>/i.test(paragraphProperties);

    paragraphs.push({
      text,
      kind: headingLevel ? "heading" : isList ? "list" : "paragraph",
      headingLevel,
    });
  }

  return paragraphs;
}

interface DocxBlockInput {
  text: string;
  kind: ParsedBlockKind;
  headingLevel: number | null;
  metadata?: JsonObject;
}

function parseDocxBodyBlocks(xml: string): { blocks: DocxBlockInput[]; hasUnreliableTables: boolean } {
  const body = xml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i)?.[1] ?? xml;
  const blocks: DocxBlockInput[] = [];
  let tableNumber = 0;
  let hasUnreliableTables = false;

  for (const match of body.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/gi)) {
    const element = match[0];
    if (/^<w:p(?:\s|>)/i.test(element)) {
      blocks.push(...parseDocxParagraphs(element));
      continue;
    }

    tableNumber += 1;
    const rows = Array.from(element.matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/gi), (row) =>
      Array.from(row[1]?.matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/gi) ?? [], (cell) =>
        parseDocxParagraphs(cell[1] ?? "").map((paragraph) => paragraph.text).join(" ").trim(),
      ),
    ).filter((row) => row.some(Boolean));
    const firstRow = rows[0] ?? [];
    const hasHeader = firstRow.length >= 2 && firstRow.every((cell) =>
      cell.length > 0 && !Number.isFinite(Number(cell)),
    );
    const headers = hasHeader ? firstRow : [];
    const rowWidths = new Set(rows.map((row) => row.length));
    if (/<w:(?:gridSpan|vMerge)(?:\s|>)/i.test(element) || rowWidths.size > 1) {
      hasUnreliableTables = true;
    }

    rows.forEach((cells, rowIndex) => {
      const headerRow = hasHeader && rowIndex === 0;
      const text = cells.map((cell, columnIndex) => {
        const label = headers[columnIndex] || `Column ${columnIndex + 1}`;
        return headerRow ? `Column ${columnIndex + 1}=${cell}` : `${label}=${cell}`;
      }).join(" | ");
      blocks.push({
        text: `${headerRow ? `Table ${tableNumber} headers` : `Table ${tableNumber} row ${rowIndex + 1}`}: ${text}`,
        kind: headerRow ? "heading" : "paragraph",
        headingLevel: headerRow ? 2 : null,
        metadata: { tableNumber, rowNumber: rowIndex + 1, cells, headerRow },
      });
    });
  }

  return { blocks, hasUnreliableTables };
}

export class DocxDocumentParser implements ContentParser {
  readonly name = "docx";
  readonly version = "1.0.0";

  supports(source: DocumentProcessingSource): boolean {
    return (
      normalizeExtension(source.fileExtension) === "docx" ||
      normalizeMimeType(source.mimeType) ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  }

  async parse(source: DocumentProcessingSource): Promise<ParsedDocument> {
    try {
      const documentXml = new TextDecoder("utf-8", { fatal: true }).decode(
        zipEntry(source.content, "word/document.xml"),
      );
      const parsedBody = parseDocxBodyBlocks(documentXml);
      const extractionWarnings = [
        ...(parsedBody.hasUnreliableTables
          ? [{
              code: "DOCX_TABLE_STRUCTURE_NOT_PRESERVED",
              severity: "review_required",
              message: "A merged, nested, or irregular table could not be mapped to reliable row and column relationships.",
            }]
          : []),
        ...( /<w:drawing(?:\s|>)/i.test(documentXml) || /<w:object(?:\s|>)/i.test(documentXml)
          ? [{
              code: "DOCX_EMBEDDED_CONTENT_NOT_EXTRACTED",
              severity: "review_required",
              message: "An image or embedded object was not inspected for text or data.",
            }]
          : []),
        ...( /<w:chart(?:\s|>)/i.test(documentXml)
          ? [{
              code: "DOCX_CHART_NOT_EXTRACTED",
              severity: "review_required",
              message: "An embedded chart was not converted to verified data points.",
            }]
          : []),
      ];
      assertHasContent(parsedBody.blocks.map((block) => ({
        kind: block.kind,
        text: block.text,
        headingLevel: block.headingLevel,
        locator: {
          pageStart: null,
          pageEnd: null,
          lineStart: null,
          lineEnd: null,
          startChar: null,
          endChar: null,
        },
        metadata: {},
      })));

      let charOffset = 0;
      const blocks = parsedBody.blocks.map((block, index) => {
        const startChar = charOffset;
        charOffset += block.text.length + 1;
        return {
          id: `block-${String(index).padStart(4, "0")}`,
          kind: block.kind,
          text: block.text,
          headingLevel: block.headingLevel,
          locator: {
            pageStart: null,
            pageEnd: null,
            lineStart: index + 1,
            lineEnd: index + 1,
            startChar,
            endChar: startChar + block.text.length,
          },
          metadata: block.metadata ?? {},
        } satisfies ParsedContentBlock;
      });

      return {
        source: sourceDescriptor(source),
        title: parsedBody.blocks.find((block) => block.headingLevel === 1)?.text ?? null,
        metadata: {
          format: "Office Open XML",
          ...(extractionWarnings.length > 0 ? { extractionWarnings } : {}),
        },
        parser: { name: this.name, version: this.version },
        blocks,
        pageCount: null,
        charCount: Math.max(0, charOffset - 1),
      };
    } catch (error) {
      if (error instanceof DocumentParsingError) throw error;
      throw new DocumentParsingError("DOCX_PARSE_FAILED", "The DOCX could not be parsed.", error);
    }
  }
}

export interface PdfExtractedPage {
  pageNumber: number;
  text: string;
  ocrImage?: Uint8Array;
}

export interface PdfExtractionResult {
  pageCount: number;
  title: string | null;
  metadata: JsonObject;
  pages: PdfExtractedPage[];
  ocrSkippedPages?: number[];
}

export type PdfTextExtractor = (content: Uint8Array) => Promise<PdfExtractionResult>;

function toJsonValue(value: unknown, seen = new WeakSet<object>()): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (ArrayBuffer.isView(value)) {
    return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    const result: JsonObject = {};

    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry !== "undefined" && typeof entry !== "function") {
        result[key] = toJsonValue(entry, seen);
      }
    }

    seen.delete(value);
    return result;
  }

  return String(value);
}

function toJsonObject(value: unknown): JsonObject {
  const converted = toJsonValue(value);
  return converted && !Array.isArray(converted) && typeof converted === "object"
    ? converted
    : {};
}

function stringProperty(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

async function extractPdfText(content: Uint8Array): Promise<PdfExtractionResult> {
  // pdf-parse's Node worker installs DOMMatrix/Path2D/ImageData before the
  // pdfjs runtime is evaluated. This is required in Vercel's Node runtime,
  // where browser canvas globals are not present.
  await import("pdf-parse/worker");
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: content.slice() });

  try {
    const infoResult = await parser.getInfo();
    const textResult = await parser.getText();
    const textPages = textResult.pages.map((page) => ({
      pageNumber: page.num,
      text: page.text,
    }));
    const pagesWithoutText = textPages.filter((page) => !page.text.trim());
    const ocrTargets = pagesWithoutText.slice(0, 10);
    let screenshotPages: Array<{ pageNumber: number; data: Uint8Array }> = [];

    if (ocrTargets.length > 0) {
      try {
        const screenshots = await parser.getScreenshot({
          partial: ocrTargets.map((page) => page.pageNumber),
          desiredWidth: 1800,
          imageBuffer: true,
          imageDataUrl: false,
        });
        screenshotPages = screenshots.pages.map((page) => ({
          pageNumber: page.pageNumber,
          data: page.data,
        }));
      } catch {
        screenshotPages = [];
      }
    }
    const screenshotByPage = new Map(screenshotPages.map((page) => [page.pageNumber, page.data]));
    const xmpMetadata = infoResult.metadata
      ? Object.fromEntries(
          Array.from(infoResult.metadata as Iterable<[string, unknown]>),
        )
      : null;

    return {
      pageCount: textResult.total,
      title: stringProperty(infoResult.info, "Title"),
      metadata: {
        info: toJsonObject(infoResult.info),
        xmp: toJsonObject(xmpMetadata),
        xmpRaw: infoResult.metadata?.getRaw?.() ?? null,
        fingerprints: toJsonValue(infoResult.fingerprints ?? []),
        permissions: toJsonValue(infoResult.permission ?? null),
      },
      pages: textPages.map((page) => ({
        ...page,
        ...(screenshotByPage.has(page.pageNumber)
          ? { ocrImage: screenshotByPage.get(page.pageNumber) }
          : {}),
      })),
      ocrSkippedPages: pagesWithoutText.slice(10).map((page) => page.pageNumber),
    };
  } finally {
    await parser.destroy();
  }
}

export class PdfDocumentParser implements ContentParser {
  readonly name = "pdf-parse";
  readonly version = "2.4.5";

  constructor(
    private readonly extractor: PdfTextExtractor = extractPdfText,
    private readonly ocrProvider: ImageOcrProvider = new TesseractChineseOcrProvider(),
  ) {}

  supports(source: DocumentProcessingSource): boolean {
    return (
      normalizeExtension(source.fileExtension) === "pdf" ||
      normalizeMimeType(source.mimeType) === "application/pdf"
    );
  }

  async parse(source: DocumentProcessingSource): Promise<ParsedDocument> {
    let extraction: PdfExtractionResult;

    try {
      extraction = await this.extractor(source.content);
    } catch (error) {
      if (error instanceof DocumentParsingError) {
        throw error;
      }

      throw new DocumentParsingError(
        "PDF_PARSE_FAILED",
        "The PDF could not be parsed.",
        error,
      );
    }

    const blocks: UnnumberedBlock[] = [];
    const extractionWarnings: JsonObject[] = [];
    const ocrPages: JsonObject[] = [];
    let charOffset = 0;
    let lineOffset = 0;

    for (const page of extraction.pages) {
      if (page.text.trim()) {
        blocks.push(
          ...plainTextBlocks(page.text, {
            pageNumber: page.pageNumber,
            charOffset,
            lineOffset,
          }),
        );
        charOffset += page.text.length + 2;
        lineOffset += scanLines(page.text).length + 1;
        continue;
      }

      if (!page.ocrImage) {
        extractionWarnings.push({
          code: "PAGE_HAS_NO_EXTRACTABLE_TEXT",
          pageNumber: page.pageNumber,
          severity: "review_required",
          message: "This page has no extractable text and OCR could not render it. Upload a text-based or OCR-processed PDF.",
        });
        continue;
      }

      try {
        const result = await this.ocrProvider.recognize(page.ocrImage);
        if (result.lines.length === 0) {
          extractionWarnings.push({
            code: "OCR_NO_TEXT",
            pageNumber: page.pageNumber,
            severity: "review_required",
            message: "OCR found no readable text on this page. Upload a clearer scan or provide a verified text transcription.",
          });
          continue;
        }

        const pageBlocks = ocrBlocks(result, { pageNumber: page.pageNumber, charOffset });
        blocks.push(...pageBlocks);
        charOffset += pageBlocks.reduce((total, block) => total + block.text.length + 1, 0);
        extractionWarnings.push(ocrReviewWarning(result, `Page ${page.pageNumber}`));
        const confidenceWarning = ocrConfidenceWarning(result, `Page ${page.pageNumber}`);
        if (confidenceWarning) extractionWarnings.push(confidenceWarning);
        ocrPages.push({
          pageNumber: page.pageNumber,
          averageConfidence: result.averageConfidence,
          minimumWordConfidence: result.minimumWordConfidence,
          effectiveAverageConfidence: result.effectiveAverageConfidence ?? result.averageConfidence,
          effectiveMinimumWordConfidence: result.effectiveMinimumWordConfidence ?? result.minimumWordConfidence,
          wordCount: result.wordCount,
          languagesUsed: result.languagesUsed ?? ["chi_sim"],
        });
      } catch {
        extractionWarnings.push({
          code: "OCR_FAILED",
          pageNumber: page.pageNumber,
          severity: "review_required",
          message: "OCR could not process this page. Upload a clearer scan or provide a verified text transcription.",
        });
      }
    }

    for (const pageNumber of extraction.ocrSkippedPages ?? []) {
      extractionWarnings.push({
        code: "OCR_PAGE_LIMIT_EXCEEDED",
        pageNumber,
        severity: "review_required",
        message: "OCR was limited to 10 scanned pages per document. Split the file or upload a verified text-based PDF.",
      });
    }

    if (blocks.length === 0) {
      throw new DocumentParsingError(
        "EMPTY_DOCUMENT",
        "No readable text was extracted from this PDF. Use OCR with a supported tool or provide a verified text transcription.",
      );
    }
    assertHasContent(blocks);
    const languagesUsed = [...new Set(ocrPages.flatMap((page) =>
      Array.isArray(page.languagesUsed)
        ? page.languagesUsed.filter((language): language is string => typeof language === "string")
        : [],
    ))];

    return {
      source: sourceDescriptor(source),
      title: extraction.title,
      metadata: {
        ...extraction.metadata,
        ...(ocrPages.length > 0
          ? { ocr: { engine: "tesseract.js", languagesUsed, pages: ocrPages } }
          : {}),
        ...(extractionWarnings.length > 0 ? { extractionWarnings } : {}),
      },
      parser: { name: this.name, version: this.version },
      blocks: numberBlocks(blocks),
      pageCount: extraction.pageCount,
      charCount: Math.max(0, charOffset - 2),
    };
  }
}

export class ImageDocumentParser implements ContentParser {
  readonly name = "image-ocr";
  readonly version = "1.0.0";

  constructor(private readonly ocrProvider: ImageOcrProvider = new TesseractChineseOcrProvider()) {}

  supports(source: DocumentProcessingSource): boolean {
    const extension = normalizeExtension(source.fileExtension);
    const mimeType = normalizeMimeType(source.mimeType);
    return ["png", "jpg", "jpeg"].includes(extension) || ["image/png", "image/jpeg"].includes(mimeType);
  }

  async parse(source: DocumentProcessingSource): Promise<ParsedDocument> {
    let result: OcrResult;
    try {
      result = await this.ocrProvider.recognize(source.content);
    } catch (error) {
      throw new DocumentParsingError(
        "OCR_FAILED",
        "Image OCR failed. Verify the image and upload a clearer scan or a verified text transcription.",
        error,
      );
    }
    if (result.lines.length === 0) {
      throw new DocumentParsingError(
        "EMPTY_DOCUMENT",
        "OCR found no readable printed text. Handwriting is not supported; provide a verified text transcription.",
      );
    }

    const blocks = ocrBlocks(result, { pageNumber: 1, charOffset: 0 }).map((block, index) => ({
      ...block,
      id: `block-${String(index).padStart(4, "0")}`,
    }));
    const extractionWarnings = [
      ocrReviewWarning(result, "Image page 1"),
      ...(ocrConfidenceWarning(result, "Image page 1") ? [ocrConfidenceWarning(result, "Image page 1")!] : []),
    ];

    return {
      source: sourceDescriptor(source),
      title: blocks[0]?.text ?? null,
      metadata: {
        format: "image",
        ocr: {
          engine: "tesseract.js",
          language: result.languagesUsed?.join("+") ?? "chi_sim",
          averageConfidence: result.averageConfidence,
          minimumWordConfidence: result.minimumWordConfidence,
          effectiveAverageConfidence: result.effectiveAverageConfidence ?? result.averageConfidence,
          effectiveMinimumWordConfidence: result.effectiveMinimumWordConfidence ?? result.minimumWordConfidence,
          wordCount: result.wordCount,
          languagesUsed: result.languagesUsed ?? ["chi_sim"],
        },
        extractionWarnings,
      },
      parser: { name: this.name, version: this.version },
      blocks,
      pageCount: 1,
      charCount: Math.max(0, blocks.reduce((total, block) => total + block.text.length + 1, 0) - 1),
    };
  }
}

export class ParserLayer {
  constructor(
    private readonly parsers: readonly ContentParser[] = [
      new MarkdownDocumentParser(),
      new DocxDocumentParser(),
      new LazyOfficeDocumentParser("xlsx"),
      new LazyOfficeDocumentParser("pptx"),
      new PdfDocumentParser(),
      new ImageDocumentParser(),
      new PlainTextDocumentParser(),
    ],
  ) {}

  resolve(source: DocumentProcessingSource): ContentParser {
    const parser = this.parsers.find((candidate) => candidate.supports(source));

    if (!parser) {
      throw new DocumentParsingError(
        "UNSUPPORTED_DOCUMENT_TYPE",
        `No parser is registered for ${source.mimeType || source.fileExtension}.`,
      );
    }

    return parser;
  }

  async parse(source: DocumentProcessingSource): Promise<ParsedDocument> {
    return this.resolve(source).parse(source);
  }
}

class LazyOfficeDocumentParser implements ContentParser {
  readonly version = "1.0.0";

  constructor(readonly name: "xlsx" | "pptx") {}

  supports(source: DocumentProcessingSource): boolean {
    const extension = normalizeExtension(source.fileExtension);
    const mimeType = normalizeMimeType(source.mimeType);
    return this.name === "xlsx"
      ? extension === "xlsx" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : extension === "pptx" || mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }

  async parse(source: DocumentProcessingSource): Promise<ParsedDocument> {
    const office = await import("./ooxml-parser");
    const parser = this.name === "xlsx"
      ? new office.XlsxDocumentParser()
      : new office.PptxDocumentParser();
    return parser.parse(source);
  }
}

const defaultParserLayer = new ParserLayer();

export async function parseDocument(
  source: DocumentProcessingSource,
): Promise<ParsedDocument> {
  return defaultParserLayer.parse(source);
}
