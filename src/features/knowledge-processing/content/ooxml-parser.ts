import { inflateRawSync } from "node:zlib";
import { posix } from "node:path";

import type { JsonObject } from "@/domain";

import {
  DocumentParsingError,
  type ContentParser,
  type DocumentProcessingSource,
  type ParsedBlockKind,
  type ParsedContentBlock,
  type ParsedDocument,
  type SourceLocator,
} from "./parser";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRIES = 2048;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

interface XmlElement {
  attributes: Record<string, string>;
  inner: string;
}

interface Warning extends JsonObject {
  code: string;
  message: string;
  severity: "notice" | "review_required";
  location: string | null;
}

interface BlockInput {
  kind: ParsedBlockKind;
  text: string;
  headingLevel: number | null;
  locator: SourceLocator;
  metadata: JsonObject;
}

function decodeXml(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (entity, token: string) => {
      const normalized = token.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      if (normalized === "quot") return "\"";
      if (normalized === "apos") return "'";
      const codePoint = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : Number.parseInt(normalized.slice(1), 10);
      return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
    },
  );
}

function xmlElements(xml: string, localName: string): XmlElement[] {
  const pattern = new RegExp(
    "<(?:[A-Za-z_][\\w.-]*:)?" +
      localName +
      "\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?" +
      localName +
      "\\s*>)",
    "gi",
  );
  const result: XmlElement[] = [];

  for (const match of xml.matchAll(pattern)) {
    const attributes: Record<string, string> = {};
    for (const attribute of (match[1] ?? "").matchAll(
      /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    )) {
      const key = attribute[1];
      if (key) attributes[key] = decodeXml(attribute[2] ?? attribute[3] ?? "");
    }
    result.push({ attributes, inner: match[2] ?? "" });
  }
  return result;
}

function textValues(xml: string, localName = "t"): string[] {
  return xmlElements(xml, localName).map((element) => decodeXml(element.inner).trim());
}

function safePath(value: string): string {
  const normalized = posix.normalize(value.replaceAll("\\", "/")).replace(/^\/+/u, "");
  if (!normalized || normalized === "." || normalized.startsWith("../")) {
    throw new Error("Invalid package path.");
  }
  return normalized;
}

function zipEntries(content: Uint8Array): Map<string, Uint8Array> {
  const bytes = Buffer.from(content);
  if (bytes.length < 22) throw new Error("Archive is too short.");
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 0xffff - 22); offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("Archive directory is missing.");

  const entryCount = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (
    entryCount === 0xffff ||
    entryCount > MAX_ENTRIES ||
    directoryOffset + directorySize > end ||
    directoryOffset + directorySize > bytes.length
  ) {
    throw new Error("Archive directory is invalid or too large.");
  }

  const result = new Map<string, Uint8Array>();
  let offset = directoryOffset;
  let totalBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > directoryOffset + directorySize || bytes.readUInt32LE(offset) !== CENTRAL) {
      throw new Error("Archive directory entry is invalid.");
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const compression = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (
      next > directoryOffset + directorySize ||
      (flags & 1) !== 0 ||
      uncompressedSize > MAX_ENTRY_BYTES ||
      localOffset + 30 > directoryOffset ||
      bytes.readUInt32LE(localOffset) !== LOCAL
    ) {
      throw new Error("Archive entry is encrypted, oversized, or invalid.");
    }

    const name = safePath(new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(nameStart, nameStart + nameLength),
    ));
    if (!name.endsWith("/")) {
      const localNameLength = bytes.readUInt16LE(localOffset + 26);
      const localExtraLength = bytes.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > directoryOffset || dataEnd > bytes.length || result.has(name)) {
        throw new Error("Archive entry bounds or names are invalid.");
      }
      const compressed = bytes.subarray(dataStart, dataEnd);
      const data = compression === 0
        ? new Uint8Array(compressed)
        : compression === 8
          ? new Uint8Array(inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES }))
          : null;
      if (!data || data.byteLength !== uncompressedSize) {
        throw new Error("Archive entry compression is unsupported or corrupt.");
      }
      totalBytes += data.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Expanded archive is too large.");
      result.set(name, data);
    }
    offset = next;
  }
  return result;
}

function archiveText(entries: ReadonlyMap<string, Uint8Array>, name: string): string | null {
  const value = entries.get(name);
  return value ? new TextDecoder("utf-8", { fatal: true }).decode(value).replace(/^\uFEFF/u, "") : null;
}

function requiredText(entries: ReadonlyMap<string, Uint8Array>, name: string): string {
  const value = archiveText(entries, name);
  if (value === null) throw new Error("Missing " + name + ".");
  return value;
}

function relationships(xml: string): Map<string, { target: string; type: string; external: boolean }> {
  const result = new Map<string, { target: string; type: string; external: boolean }>();
  for (const element of xmlElements(xml, "Relationship")) {
    const id = element.attributes.Id;
    const target = element.attributes.Target;
    if (id && target) {
      result.set(id, {
        target,
        type: element.attributes.Type ?? "",
        external: element.attributes.TargetMode === "External",
      });
    }
  }
  return result;
}

function relationshipPath(part: string): string {
  return posix.join(posix.dirname(part), "_rels", posix.basename(part) + ".rels");
}

function resolveTarget(part: string, target: string): string {
  return safePath(target.startsWith("/") ? target : posix.join(posix.dirname(part), target));
}

function locator(input: Partial<SourceLocator> = {}): SourceLocator {
  return {
    pageStart: input.pageStart ?? null,
    pageEnd: input.pageEnd ?? input.pageStart ?? null,
    lineStart: input.lineStart ?? null,
    lineEnd: input.lineEnd ?? input.lineStart ?? null,
    startChar: input.startChar ?? null,
    endChar: input.endChar ?? null,
  };
}

function makeWarning(
  code: string,
  message: string,
  location?: string,
  severity: "notice" | "review_required" = "review_required",
): Warning {
  return { code, message, severity, location: location ?? null };
}

function finishDocument(input: {
  source: DocumentProcessingSource;
  title: string | null;
  parser: string;
  blocks: BlockInput[];
  warnings: Warning[];
  metadata?: JsonObject;
  pageCount?: number | null;
}): ParsedDocument {
  let offset = 0;
  const blocks: ParsedContentBlock[] = input.blocks.map((block, index) => {
    const start = block.locator.startChar ?? offset;
    offset = start + block.text.length + 1;
    return {
      id: "block-" + String(index).padStart(4, "0"),
      ...block,
      locator: {
        ...block.locator,
        startChar: start,
        endChar: block.locator.endChar ?? start + block.text.length,
      },
    };
  });
  return {
    source: {
      documentId: input.source.documentId,
      displayName: input.source.displayName,
      mimeType: input.source.mimeType,
      fileExtension: input.source.fileExtension,
      metadata: input.source.metadata,
    },
    title: input.title,
    metadata: {
      format: "Office Open XML",
      ...(input.metadata ?? {}),
      ...(input.warnings.length > 0 ? { extractionWarnings: input.warnings } : {}),
    },
    parser: { name: input.parser, version: "1.0.0" },
    blocks,
    pageCount: input.pageCount ?? null,
    charCount: Math.max(0, offset - 1),
  };
}

function cellRef(reference: string): { column: number; row: number } | null {
  const match = reference.match(/^([A-Z]+)(\d+)$/iu);
  if (!match?.[1] || !match[2]) return null;
  let column = 0;
  for (const char of match[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]);
  return Number.isSafeInteger(row) && row > 0 ? { column, row } : null;
}

function sharedStrings(xml: string | null): string[] {
  return xml ? xmlElements(xml, "si").map((item) => textValues(item.inner).join("")) : [];
}

function dateStyles(xml: string | null): Set<number> {
  const builtinFormats = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  if (!xml) return new Set();
  const customDateFormats = new Set<number>();
  for (const item of xmlElements(xmlElements(xml, "numFmts")[0]?.inner ?? "", "numFmt")) {
    const formatCode = item.attributes.formatCode ?? "";
    if (/[ymdhis]/iu.test(formatCode.replace(/"[^"]*"|'[^']*'|\[[^\]]*\]/gu, ""))) {
      const id = Number(item.attributes.numFmtId);
      if (Number.isSafeInteger(id)) customDateFormats.add(id);
    }
  }
  const result = new Set<number>();
  xmlElements(xmlElements(xml, "cellXfs")[0]?.inner ?? "", "xf").forEach((item, index) => {
    const format = Number(item.attributes.numFmtId);
    if (builtinFormats.has(format) || customDateFormats.has(format)) result.add(index);
  });
  return result;
}

function excelDate(value: string): string {
  const serial = Number(value);
  if (!Number.isFinite(serial)) return value;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000))
    .toISOString()
    .replace(/T00:00:00\.000Z$/u, "");
}

function worksheetRows(
  xml: string,
  sheetName: string,
  strings: readonly string[],
  dates: ReadonlySet<number>,
  warnings: Warning[],
): Array<{ row: number; cells: Array<{ ref: string; value: string }> }> {
  const rows: Array<{ row: number; cells: Array<{ ref: string; value: string }> }> = [];
  for (const rowElement of xmlElements(xml, "row")) {
    const row = Number(rowElement.attributes.r);
    if (!Number.isSafeInteger(row) || row < 1) throw new Error("Worksheet row number is invalid.");
    const hidden = rowElement.attributes.hidden === "1" || rowElement.attributes.hidden === "true";
    if (hidden) {
      warnings.push(makeWarning("XLSX_HIDDEN_ROW_OMITTED", "Hidden row content was omitted from searchable text.", "Sheet " + sheetName + " row " + row));
      continue;
    }
    const cells: Array<{ ref: string; value: string }> = [];
    for (const cell of xmlElements(rowElement.inner, "c")) {
      const ref = cell.attributes.r;
      if (!ref || !cellRef(ref)) throw new Error("Worksheet cell reference is invalid.");
      const raw = xmlElements(cell.inner, "v")[0]?.inner.trim() ?? "";
      const type = cell.attributes.t ?? "n";
      const style = Number(cell.attributes.s ?? "0");
      let value = type === "s"
        ? raw ? strings[Number(raw)] ?? "" : ""
        : type === "inlineStr"
          ? textValues(cell.inner).join("")
          : type === "b"
            ? raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : raw
            : type === "e"
              ? "[Excel error " + raw + "]"
              : dates.has(style) && raw ? excelDate(raw) : raw;
      if (type === "e") warnings.push(makeWarning("XLSX_CELL_ERROR_VALUE", "An Excel error value was extracted literally and must be reviewed.", "Sheet " + sheetName + " cell " + ref));
      const formula = xmlElements(cell.inner, "f")[0]?.inner.trim() ?? "";
      if (formula) {
        const missing = !raw;
        warnings.push(makeWarning(
          missing ? "XLSX_FORMULA_NO_CACHED_VALUE" : "XLSX_FORMULA_CACHED_VALUE_ONLY",
          missing ? "A formula has no cached result; formulas are not recalculated." : "A formula result is read from the workbook cache only; formulas are not recalculated.",
          "Sheet " + sheetName + " cell " + ref,
        ));
        value = value + " [formula: =" + decodeXml(formula) + (missing ? "; not calculated]" : "; cached result]");
      }
      if (value.trim()) cells.push({ ref, value: decodeXml(value) });
    }
    if (cells.length > 0) rows.push({ row, cells });
  }
  return rows;
}

export class XlsxDocumentParser implements ContentParser {
  readonly name = "xlsx";
  readonly version = "1.0.0";

  supports(source: DocumentProcessingSource): boolean {
    return source.fileExtension.trim().toLowerCase().replace(/^\./u, "") === "xlsx" ||
      source.mimeType.split(";", 1)[0]?.trim().toLowerCase() === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  async parse(source: DocumentProcessingSource): Promise<ParsedDocument> {
    try {
      const entries = zipEntries(source.content);
      const workbookPath = "xl/workbook.xml";
      const workbook = requiredText(entries, workbookPath);
      const rels = relationships(requiredText(entries, relationshipPath(workbookPath)));
      const strings = sharedStrings(archiveText(entries, "xl/sharedStrings.xml"));
      const dates = dateStyles(archiveText(entries, "xl/styles.xml"));
      const warnings: Warning[] = [];
      const blocks: BlockInput[] = [];
      const sheets = xmlElements(workbook, "sheet");
      let title: string | null = null;
      let visibleSheets = 0;
      for (const sheet of sheets) {
        const name = sheet.attributes.name?.trim() || "Unnamed";
        if (sheet.attributes.state === "hidden" || sheet.attributes.state === "veryHidden") {
          warnings.push(makeWarning("XLSX_HIDDEN_SHEET_OMITTED", "Hidden worksheet content was omitted from searchable text.", "Sheet " + name));
          continue;
        }
        const relation = rels.get(sheet.attributes["r:id"] ?? "");
        if (!relation || relation.external) throw new Error("Worksheet relationship is missing or external.");
        const xml = requiredText(entries, resolveTarget(workbookPath, relation.target));
        const rows = worksheetRows(xml, name, strings, dates, warnings);
        if (rows.length === 0) continue;
        visibleSheets += 1;
        title ??= rows[0]?.cells[0]?.value ?? null;
        blocks.push({ kind: "heading", text: "Worksheet: " + name, headingLevel: 1, locator: locator(), metadata: { sheetName: name } });
        const header = rows.find((row) => row.cells.length >= 2 && row.cells.every((cell) => !Number.isFinite(Number(cell.value))));
        const headerMap = new Map((header?.cells ?? []).flatMap((cell) => {
          const coordinate = cellRef(cell.ref);
          return coordinate ? [[coordinate.column, cell.value] as const] : [];
        }));
        for (const row of rows) {
          const isHeader = row === header;
          const text = row.cells.map((cell) => {
            const coordinate = cellRef(cell.ref);
            const label = coordinate ? headerMap.get(coordinate.column) : undefined;
            return label && !isHeader ? label + "=" + cell.value : cell.ref + "=" + cell.value;
          }).join(" | ");
          blocks.push({
            kind: isHeader ? "heading" : "paragraph",
            text: (isHeader ? "Headers: " : "Row " + row.row + ": ") + text,
            headingLevel: isHeader ? 2 : null,
            locator: locator({ lineStart: row.row }),
            metadata: { sheetName: name, rowNumber: row.row, cellReferences: row.cells.map((cell) => cell.ref), headerRow: isHeader },
          });
        }
        if (/<(?:[A-Za-z_][\w.-]*:)?drawing\b/iu.test(xml)) warnings.push(makeWarning("XLSX_DRAWING_NOT_EXTRACTED", "Worksheet drawings or images were not inspected.", "Sheet " + name));
        if (/<(?:[A-Za-z_][\w.-]*:)?mergeCells\b/iu.test(xml)) warnings.push(makeWarning("XLSX_MERGED_CELLS_PRESENT", "Merged cells are retained through their anchor value; verify data meaning.", "Sheet " + name, "notice"));
      }
      if (sheets.length === 0 || visibleSheets === 0 || blocks.length === 0) throw new Error("Workbook has no visible extractable worksheets.");
      const chartPaths = [...entries.keys()].filter((name) => /^xl\/charts\/chart\d+\.xml$/iu.test(name));
      for (const chartPath of chartPaths) {
        const chartXml = archiveText(entries, chartPath);
        const series = chartXml ? chartSeries(chartXml) : [];
        if (series.length === 0 || series.some((item) => item.values.length === 0)) {
          warnings.push(makeWarning(
            "XLSX_CHART_CACHE_UNAVAILABLE",
            "The chart has no complete embedded category/value cache; its source data was not recalculated.",
            chartPath,
          ));
          continue;
        }
        blocks.push({
          kind: "heading",
          text: "Chart: " + chartPath,
          headingLevel: 2,
          locator: locator({ lineStart: blocks.length + 1 }),
          metadata: { chartPath, cachedChartData: true },
        });
        for (const item of series) {
          blocks.push({
            kind: "paragraph",
            text: "Series (" + item.name + "): " + item.values.join(" | "),
            headingLevel: null,
            locator: locator({ lineStart: blocks.length + 1 }),
            metadata: { chartPath, seriesName: item.name, cachedChartData: true },
          });
        }
        warnings.push(makeWarning(
          "XLSX_CHART_CACHE_USED",
          "Chart series values were extracted from embedded data, but chart labels and units must be verified before question answering.",
          chartPath,
        ));
      }
      if ([...entries.keys()].some((name) => /^xl\/comments\d*\.xml$/iu.test(name))) warnings.push(makeWarning("XLSX_COMMENTS_NOT_EXTRACTED", "Workbook comments were not extracted."));
      if ([...entries.keys()].some((name) => /^xl\/externalLinks\//iu.test(name))) warnings.push(makeWarning("XLSX_EXTERNAL_LINKS_NOT_RESOLVED", "External workbook links were not fetched."));
      return finishDocument({ source, title, parser: this.name, blocks, warnings, pageCount: null, metadata: { worksheetCount: sheets.length, visibleWorksheetCount: visibleSheets } });
    } catch (error) {
      throw new DocumentParsingError("XLSX_PARSE_FAILED", "The XLSX could not be parsed safely.", error);
    }
  }
}

function chartSeries(xml: string): Array<{ name: string; values: string[] }> {
  return xmlElements(xml, "ser").map((series, index) => {
    const titleXml = xmlElements(series.inner, "tx")[0]?.inner ?? "";
    const name = textValues(titleXml, "v")[0] ?? textValues(titleXml)[0] ?? "Series " + (index + 1);
    const categories = xmlElements(series.inner, "cat")[0]?.inner ?? "";
    const values = xmlElements(series.inner, "val")[0]?.inner ?? "";
    const categoryValues = xmlElements(categories, "strCache")
      .concat(xmlElements(categories, "numCache"), xmlElements(categories, "strLit"), xmlElements(categories, "numLit"))
      .flatMap((cache) => xmlElements(cache.inner, "pt"))
      .map((point) => textValues(point.inner, "v")[0] ?? "");
    const numericValues = xmlElements(values, "numCache")
      .concat(xmlElements(values, "strCache"), xmlElements(values, "numLit"), xmlElements(values, "strLit"))
      .flatMap((cache) => xmlElements(cache.inner, "pt"))
      .map((point) => textValues(point.inner, "v")[0] ?? "");
    return {
      name,
      values: numericValues.map((value, pointIndex) => {
        const category = categoryValues[pointIndex];
        return category ? category + "=" + value : "point " + (pointIndex + 1) + "=" + value;
      }),
    };
  });
}

function tableRows(tableXml: string): string[][] {
  return xmlElements(tableXml, "tr").map((row) =>
    xmlElements(row.inner, "tc").map((cell) =>
      xmlElements(cell.inner, "p").map((paragraph) => textValues(paragraph.inner).join("")).join(" ").trim(),
    ),
  );
}

function speakerNoteText(xml: string): string[] {
  const notes: string[] = [];
  for (const shape of xmlElements(xml, "sp")) {
    const placeholder = xmlElements(shape.inner, "ph")[0]?.attributes.type;
    if (["sldNum", "sldImg", "dt", "hdr", "ftr"].includes(placeholder ?? "")) continue;
    const body = xmlElements(shape.inner, "txBody")[0]?.inner ?? "";
    for (const paragraph of xmlElements(body, "p")) {
      const text = textValues(paragraph.inner).join("").trim();
      if (text) notes.push(text);
    }
  }
  return notes;
}

export class PptxDocumentParser implements ContentParser {
  readonly name = "pptx";
  readonly version = "1.0.0";

  supports(source: DocumentProcessingSource): boolean {
    return source.fileExtension.trim().toLowerCase().replace(/^\./u, "") === "pptx" ||
      source.mimeType.split(";", 1)[0]?.trim().toLowerCase() === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }

  async parse(source: DocumentProcessingSource): Promise<ParsedDocument> {
    try {
      const entries = zipEntries(source.content);
      const presentationPath = "ppt/presentation.xml";
      const presentation = requiredText(entries, presentationPath);
      const presentationRels = relationships(requiredText(entries, relationshipPath(presentationPath)));
      const slideIds = xmlElements(presentation, "sldId");
      if (slideIds.length === 0) throw new Error("Presentation has no slides.");

      const warnings: Warning[] = [];
      const blocks: BlockInput[] = [];
      let title: string | null = null;

      for (const [slideIndex, slideId] of slideIds.entries()) {
        const slideNumber = slideIndex + 1;
        const slideLabel = "Slide " + slideNumber;
        const relation = presentationRels.get(slideId.attributes["r:id"] ?? "");
        if (!relation || relation.external) throw new Error("Slide relationship is missing or external.");
        const slidePath = resolveTarget(presentationPath, relation.target);
        const slideXml = requiredText(entries, slidePath);
        const slideRels = relationships(archiveText(entries, relationshipPath(slidePath)) ?? "");

        blocks.push({
          kind: "heading",
          text: slideLabel,
          headingLevel: 1,
          locator: locator({ pageStart: slideNumber }),
          metadata: { slideNumber },
        });

        const shapes = xmlElements(slideXml, "sp");
        let paragraphNumber = 0;
        for (const shape of shapes) {
          const textBody = xmlElements(shape.inner, "txBody")[0]?.inner;
          if (!textBody) continue;
          for (const paragraph of xmlElements(textBody, "p")) {
            const text = textValues(paragraph.inner).join("").trim();
            if (!text) continue;
            paragraphNumber += 1;
            title ??= slideNumber === 1 && paragraphNumber === 1 ? text : null;
            blocks.push({
              kind: paragraphNumber === 1 ? "heading" : "paragraph",
              text,
              headingLevel: paragraphNumber === 1 ? 2 : null,
              locator: locator({
                pageStart: slideNumber,
                lineStart: paragraphNumber,
              }),
              metadata: { slideNumber, paragraphNumber },
            });
          }
        }

        let tableNumber = 0;
        for (const graphicFrame of xmlElements(slideXml, "graphicFrame")) {
          const tableXml = xmlElements(graphicFrame.inner, "tbl")[0]?.inner;
          if (!tableXml) continue;
          tableNumber += 1;
          for (const [rowIndex, cells] of tableRows(tableXml).entries()) {
            if (!cells.some(Boolean)) continue;
            const header = rowIndex === 0;
            const labels = tableRows(tableXml)[0] ?? [];
            const text = cells.map((cell, cellIndex) =>
              header
                ? "Column " + (cellIndex + 1) + "=" + cell
                : (labels[cellIndex] || "Column " + (cellIndex + 1)) + "=" + cell,
            ).join(" | ");
            blocks.push({
              kind: header ? "heading" : "paragraph",
              text: (header ? "Table " + tableNumber + " headers: " : "Table " + tableNumber + " row " + (rowIndex + 1) + ": ") + text,
              headingLevel: header ? 3 : null,
              locator: locator({
                pageStart: slideNumber,
                lineStart: rowIndex + 1,
              }),
              metadata: { slideNumber, tableNumber, rowNumber: rowIndex + 1, cells },
            });
          }
        }

        for (const [chartIndex, chartReference] of xmlElements(slideXml, "chart").entries()) {
          const chartRelation = slideRels.get(chartReference.attributes["r:id"] ?? "");
          if (!chartRelation || chartRelation.external) {
            warnings.push(makeWarning("PPTX_CHART_RELATIONSHIP_UNRESOLVED", "A chart is linked to a missing or external part.", slideLabel));
            continue;
          }
          const chartPath = resolveTarget(slidePath, chartRelation.target);
          const chartXml = archiveText(entries, chartPath);
          if (!chartXml) {
            warnings.push(makeWarning("PPTX_CHART_PART_MISSING", "A chart part could not be read.", slideLabel));
            continue;
          }
          const series = chartSeries(chartXml);
          if (series.length === 0 || series.some((item) => item.values.length === 0)) {
            warnings.push(makeWarning("PPTX_CHART_CACHE_UNAVAILABLE", "Chart categories or values are absent from the embedded cache.", slideLabel));
            continue;
          }
          blocks.push({
            kind: "heading",
            text: "Chart " + (chartIndex + 1),
            headingLevel: 3,
            locator: locator({ pageStart: slideNumber, lineStart: paragraphNumber + 1 }),
            metadata: { slideNumber, chartPath, cachedChartData: true },
          });
          for (const item of series) {
            const text = "Chart (" + item.name + "): " + item.values.join(" | ");
            blocks.push({
              kind: "paragraph",
              text,
              headingLevel: null,
              locator: locator({
                pageStart: slideNumber,
                lineStart: paragraphNumber + 1,
              }),
              metadata: { slideNumber, chartPath, seriesName: item.name, cachedChartData: true },
            });
          }
          warnings.push(makeWarning(
            "PPTX_CHART_CACHE_USED",
            "Chart series values were extracted from embedded data, but chart labels and units must be verified before question answering.",
            slideLabel,
          ));
        }

        if (/<(?:[A-Za-z_][\w.-]*:)?pic\b/iu.test(slideXml) || /<(?:[A-Za-z_][\w.-]*:)?blip\b/iu.test(slideXml)) {
          warnings.push(makeWarning("PPTX_IMAGE_NOT_OCRD", "Embedded image labels and handwritten content were not OCR-processed.", slideLabel));
        }
        if (/<(?:[A-Za-z_][\w.-]*:)?grpSp\b/iu.test(slideXml) || /<(?:[A-Za-z_][\w.-]*:)?oleObj\b/iu.test(slideXml) || /<dgm:relIds\b/iu.test(slideXml)) {
          warnings.push(makeWarning("PPTX_COMPLEX_GRAPHIC_NOT_INTERPRETED", "Grouped shapes, SmartArt, or embedded objects may contain structure that was not interpreted.", slideLabel));
        }

        const notesRelation = [...slideRels.values()].find((item) => /\/notesSlide$/u.test(item.type));
        if (notesRelation && !notesRelation.external) {
          const notesPath = resolveTarget(slidePath, notesRelation.target);
          const notesXml = archiveText(entries, notesPath);
          if (!notesXml) {
            warnings.push(makeWarning("PPTX_SPEAKER_NOTES_PART_MISSING", "Speaker notes could not be read.", slideLabel));
          } else {
            const notes = speakerNoteText(notesXml);
            if (notes.length > 0) blocks.push({
              kind: "heading",
              text: "Speaker notes",
              headingLevel: 3,
              locator: locator({ pageStart: slideNumber, lineStart: paragraphNumber + 1 }),
              metadata: { slideNumber, speakerNote: true },
            });
            for (const note of notes) {
              blocks.push({
                kind: "paragraph",
                text: "Speaker note: " + note,
                headingLevel: null,
                locator: locator({
                  pageStart: slideNumber,
                  lineStart: paragraphNumber + 1,
                }),
                metadata: { slideNumber, speakerNote: true },
              });
            }
          }
        }
      }

      if (blocks.length === slideIds.length) throw new Error("Presentation contains no extractable slide text.");
      return finishDocument({
        source,
        title,
        parser: this.name,
        blocks,
        warnings,
        pageCount: slideIds.length,
        metadata: { slideCount: slideIds.length },
      });
    } catch (error) {
      if (error instanceof DocumentParsingError) throw error;
      throw new DocumentParsingError("PPTX_PARSE_FAILED", "The PPTX could not be parsed safely.", error);
    }
  }
}
