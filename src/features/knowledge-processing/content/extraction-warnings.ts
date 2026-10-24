export interface ReviewRequiredExtractionWarning {
  code: string;
  message: string;
  pageNumber?: number;
  location?: string;
}

export type ExtractionWarningSeverity = "notice" | "review_required";

export interface ExtractionWarning extends ReviewRequiredExtractionWarning {
  severity: ExtractionWarningSeverity;
}

export interface ExtractionSourceScope {
  pageStart?: number | null;
  pageEnd?: number | null;
  metadata?: Record<string, unknown>;
}

export function extractionWarningRemediation(code: string): string {
  switch (code) {
    case "PAGE_HAS_NO_EXTRACTABLE_TEXT":
      return "This page did not produce searchable text. Run OCR and verify the result, or upload a text-based PDF with the corrected text.";
    case "DOCX_TABLE_STRUCTURE_NOT_PRESERVED":
      return "Convert each table to Markdown or text with its headers and rows preserved, then upload the converted file.";
    case "DOCX_EMBEDDED_CONTENT_NOT_EXTRACTED":
      return "Review the image or embedded object and add its relevant text to a Markdown or text file before upload.";
    case "PPTX_CHART_CACHE_UNAVAILABLE":
    case "XLSX_CHART_CACHE_UNAVAILABLE":
    case "XLSX_CHARTS_NOT_EXTRACTED":
      return "Export the chart's underlying values as a labeled table and upload that table with the presentation or workbook.";
    case "XLSX_CHART_CACHE_USED":
    case "PPTX_CHART_CACHE_USED":
      return "Verify the chart's categories, labels, units, and values against the original, then upload a labeled table containing the checked values. Unverified chart data is not used for question answering.";
    case "XLSX_MERGED_CELLS_PRESENT":
      return "Check that merged-cell labels still describe the extracted rows and values correctly before relying on them.";
    case "DOCX_CHART_NOT_EXTRACTED":
      return "Export the chart's underlying values as a labeled table and upload that table with the document.";
    case "PPTX_IMAGE_NOT_OCRD":
      return "Run OCR on the slide image and verify every extracted label and handwritten value; upload the corrected text with the presentation.";
    case "PPTX_COMPLEX_GRAPHIC_NOT_INTERPRETED":
      return "Describe the SmartArt or grouped diagram as a labeled text outline and upload it with the presentation.";
    case "OCR_VISUAL_REVIEW_REQUIRED":
    case "OCR_LOW_CONFIDENCE":
      return "Compare every recognized label and number with the original image. Handwriting is unsupported; transcribe uncertain content into a TXT or Markdown companion and re-upload it before asking questions.";
    case "OCR_NO_TEXT":
    case "OCR_FAILED":
      return "Upload a clearer image or PDF, or provide a verified text transcription. Handwriting requires manual transcription.";
    case "OCR_PAGE_LIMIT_EXCEEDED":
      return "Split the PDF into smaller files or provide a verified text-based copy for the remaining pages.";
    default:
      return "Review the missing content, create a corrected text-based copy, and upload it before asking questions.";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function extractionWarnings(value: unknown): ExtractionWarning[] {
  const root = record(value);
  const processing = record(root?.processing);
  const normalizedMetadata = record(processing?.normalizedMetadata);
  const extracted = record(normalizedMetadata?.extracted);
  const warnings = root?.extractionWarnings ?? extracted?.extractionWarnings;

  if (!Array.isArray(warnings)) return [];

  return warnings.flatMap((value) => {
    const warning = record(value);
    if (!warning || (warning.severity !== "notice" && warning.severity !== "review_required")) return [];

    const code = typeof warning.code === "string" ? warning.code : "PARSER_REVIEW_REQUIRED";
    const message = typeof warning.message === "string" && warning.message.trim()
      ? warning.message
      : "Some document content could not be extracted.";
    const pageNumber = typeof warning.pageNumber === "number" && Number.isInteger(warning.pageNumber)
      ? warning.pageNumber
      : undefined;
    const location = typeof warning.location === "string" && warning.location.trim()
      ? warning.location.trim()
      : undefined;

    return [{
      code,
      message,
      severity: warning.severity,
      ...(pageNumber === undefined ? {} : { pageNumber }),
      ...(location === undefined ? {} : { location }),
    }];
  });
}

export function reviewRequiredExtractionWarnings(value: unknown): ReviewRequiredExtractionWarning[] {
  return extractionWarnings(value)
    .filter((warning) => warning.severity === "review_required")
    .map((warning) => ({
      code: warning.code,
      message: warning.message,
      ...(warning.pageNumber === undefined ? {} : { pageNumber: warning.pageNumber }),
      ...(warning.location === undefined ? {} : { location: warning.location }),
    }));
}

function locationPage(location: string | undefined): number | null {
  const match = location?.match(/^(?:Image\s+)?Page\s+(\d+)$/iu);
  return match?.[1] ? Number(match[1]) : null;
}

function locationSlide(location: string | undefined): number | null {
  const match = location?.match(/^Slide\s+(\d+)$/iu);
  return match?.[1] ? Number(match[1]) : null;
}

function locationSheet(location: string | undefined): string | null {
  const match = location?.match(/^Sheet\s+(.+)$/iu);
  return match?.[1]?.trim() || null;
}

/** Returns whether a review warning applies to the source block represented by a chunk segment. */
export function extractionWarningAppliesToSource(
  warning: ReviewRequiredExtractionWarning,
  source: ExtractionSourceScope,
): boolean {
  const metadata = source.metadata ?? {};
  const page = warning.pageNumber ?? locationPage(warning.location);
  if (page !== null) {
    if (source.pageStart === undefined || source.pageStart === null) return true;
    const pageEnd = source.pageEnd ?? source.pageStart;
    return page >= source.pageStart && page <= pageEnd;
  }

  const slide = locationSlide(warning.location);
  if (slide !== null) {
    if (metadata.slideNumber === undefined) return true;
    if (Number(metadata.slideNumber) !== slide) return false;
    if (warning.code === "PPTX_CHART_CACHE_USED" || warning.code === "XLSX_CHART_CACHE_USED") {
      return metadata.cachedChartData === true;
    }
    return true;
  }

  const sheet = locationSheet(warning.location);
  if (sheet) {
    if (typeof metadata.sheetName !== "string") return true;
    return metadata.sheetName.localeCompare(sheet, undefined, { sensitivity: "accent" }) === 0;
  }

  if (warning.location && /\.xml$/iu.test(warning.location)) {
    const chartPath = metadata.chartPath;
    return typeof chartPath !== "string" || chartPath === warning.location;
  }

  return true;
}

export function reviewWarningsForSources(
  warnings: readonly ReviewRequiredExtractionWarning[],
  sources: readonly ExtractionSourceScope[],
): ReviewRequiredExtractionWarning[] {
  return warnings.filter((warning) =>
    sources.length === 0 || sources.some((source) => extractionWarningAppliesToSource(warning, source)),
  );
}
