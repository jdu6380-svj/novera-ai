import { describe, expect, it } from "vitest";

import {
  extractionWarningRemediation,
  reviewWarningsForSources,
  extractionWarnings,
  reviewRequiredExtractionWarnings,
} from "./extraction-warnings";

describe("review-required extraction warnings", () => {
  it("reads parser warnings directly and from persisted document processing metadata", () => {
    const warning = {
      code: "PAGE_HAS_NO_EXTRACTABLE_TEXT",
      pageNumber: 4,
      location: "Page 4",
      severity: "review_required",
      message: "This page has no extractable text.",
    };

    expect(reviewRequiredExtractionWarnings({ extractionWarnings: [warning] })).toEqual([
      { code: warning.code, pageNumber: 4, location: "Page 4", message: warning.message },
    ]);
    expect(reviewRequiredExtractionWarnings({
      processing: {
        normalizedMetadata: {
          extracted: { extractionWarnings: [warning] },
        },
      },
    })).toEqual([{ code: warning.code, pageNumber: 4, location: "Page 4", message: warning.message }]);
  });

  it("ignores non-review warnings and malformed values", () => {
    expect(reviewRequiredExtractionWarnings({
      extractionWarnings: [
        null,
        { code: "INFO", severity: "notice", message: "Informational only." },
      ],
    })).toEqual([]);
  });

  it("preserves informational warnings for Workspace display without treating them as review blockers", () => {
    const warning = {
      code: "PPTX_CHART_CACHE_USED",
      location: "Slide 2",
      severity: "notice",
      message: "Chart data came from the embedded cache.",
    };

    expect(extractionWarnings({ extractionWarnings: [warning] })).toEqual([warning]);
    expect(reviewRequiredExtractionWarnings({ extractionWarnings: [warning] })).toEqual([]);
  });

  it("blocks XLSX chart-cache values until their labels and units are verified", () => {
    const warning = {
      code: "XLSX_CHART_CACHE_USED",
      location: "xl/charts/chart1.xml",
      severity: "review_required",
      message: "Chart series values need verification.",
    };

    expect(reviewRequiredExtractionWarnings({ extractionWarnings: [warning] })).toEqual([{
      code: warning.code,
      location: warning.location,
      message: warning.message,
    }]);
  });

  it("does not claim the app lacks scan OCR when suggesting a no-text fallback", () => {
    const remediation = extractionWarningRemediation("PAGE_HAS_NO_EXTRACTABLE_TEXT");

    expect(remediation).toContain("Run OCR and verify the result");
    expect(remediation).not.toContain("does not perform scan OCR");
  });

  it("keeps an unaffected page while excluding a warned page", () => {
    const warning = { code: "OCR_LOW_CONFIDENCE", message: "Check the scan.", pageNumber: 2 };
    expect(reviewWarningsForSources([warning], [{ pageStart: 1, pageEnd: 1 }])).toEqual([]);
    expect(reviewWarningsForSources([warning], [{ pageStart: 2, pageEnd: 2 }])).toEqual([warning]);
    expect(reviewWarningsForSources([warning], [])).toEqual([warning]);
  });

  it("separates cached chart values from ordinary text on the same slide", () => {
    const warning = { code: "PPTX_CHART_CACHE_USED", message: "Check the chart.", location: "Slide 2" };
    expect(reviewWarningsForSources([warning], [{ metadata: { slideNumber: 2 } }])).toEqual([]);
    expect(reviewWarningsForSources([warning], [{ metadata: { slideNumber: 2, cachedChartData: true } }])).toEqual([warning]);
  });
});
