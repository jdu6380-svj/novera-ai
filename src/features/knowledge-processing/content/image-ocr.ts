import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import sharp from "sharp";

export interface OcrBoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bounds: OcrBoundingBox;
  effectiveConfidence?: number;
  secondaryConfidence?: number;
  verificationMethod?: string;
}

export interface OcrLine {
  text: string;
  confidence: number;
  minimumWordConfidence: number;
  bounds: OcrBoundingBox | null;
  words: OcrWord[];
  rawText?: string;
  verificationMethod?: string;
}

export interface OcrResult {
  lines: OcrLine[];
  averageConfidence: number;
  minimumWordConfidence: number;
  wordCount: number;
  effectiveAverageConfidence?: number;
  effectiveMinimumWordConfidence?: number;
  unresolvedLowConfidenceCount?: number;
  languagesUsed?: string[];
}

export interface ImageOcrProvider {
  recognize(image: Uint8Array): Promise<OcrResult>;
}

interface TesseractWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface TesseractLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: TesseractWord[];
}

interface TesseractBlock {
  paragraphs: Array<{ lines: TesseractLine[] }>;
}

interface TesseractWorker {
  setParameters(params: Record<string, string>): Promise<unknown>;
  recognize(
    image: Buffer,
    options: Record<string, never>,
    output: { blocks: true },
  ): Promise<{ data: TesseractPage }>;
  terminate(): Promise<unknown>;
}

interface TesseractPage {
  blocks: TesseractBlock[] | null;
}

interface TesseractRuntime {
  createWorker(
    languages: string,
    oem: number,
    options: {
      langPath: string;
      workerPath: string;
      gzip: boolean;
      cacheMethod: "none";
    },
  ): Promise<TesseractWorker>;
}

const requireFromProject = createRequire(join(process.cwd(), "package.json"));

function normalizeCjkSpacing(value: string): string {
  return value
    .replace(/(?<=[\p{Script=Han}])\s+(?=[\p{Script=Han}\p{N}%])/gu, "")
    .replace(/(?<=[\p{N}])\s+(?=[\p{Script=Han}])/gu, "")
    .trim();
}

function toBounds(bbox: TesseractWord["bbox"]): OcrBoundingBox {
  return { left: bbox.x0, top: bbox.y0, right: bbox.x1, bottom: bbox.y1 };
}

function mergeBounds(words: readonly OcrWord[]): OcrBoundingBox | null {
  if (words.length === 0) return null;
  return words.reduce<OcrBoundingBox>((result, word) => ({
    left: Math.min(result.left, word.bounds.left),
    top: Math.min(result.top, word.bounds.top),
    right: Math.max(result.right, word.bounds.right),
    bottom: Math.max(result.bottom, word.bounds.bottom),
  }), { ...words[0]!.bounds });
}

function linesFromPage(page: TesseractPage): OcrLine[] {
  return (page.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => {
      const words = line.words
        .filter((word) => word.text.trim())
        .map((word) => ({
          text: word.text,
          confidence: word.confidence,
          bounds: toBounds(word.bbox),
        }));
      const text = normalizeCjkSpacing(line.text);
      if (!text) return [];
      const confidences = words.length > 0 ? words.map((word) => word.confidence) : [line.confidence];
      return [{
        text,
        rawText: line.text,
        confidence: confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
        minimumWordConfidence: Math.min(...confidences),
        bounds: mergeBounds(words) ?? toBounds(line.bbox),
        words,
      }];
    })),
  );
}

function numericToken(value: string): string | null {
  const matches = value.normalize("NFKC").replace(/\s+/gu, "").match(/\d+(?:\.\d+)?%?/gu) ?? [];
  return matches.length === 1 ? matches[0]! : null;
}

function rebuildOcrResult(lines: OcrLine[], languagesUsed: string[]): OcrResult {
  const words = lines.flatMap((line) => line.words);
  const confidences = words.map((word) => word.confidence);
  const effectiveConfidences = words.map((word) => word.effectiveConfidence ?? word.confidence);
  return {
    lines,
    averageConfidence: confidences.length > 0
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : 0,
    minimumWordConfidence: confidences.length > 0 ? Math.min(...confidences) : 0,
    wordCount: confidences.length,
    effectiveAverageConfidence: effectiveConfidences.length > 0
      ? effectiveConfidences.reduce((sum, value) => sum + value, 0) / effectiveConfidences.length
      : 0,
    effectiveMinimumWordConfidence: effectiveConfidences.length > 0 ? Math.min(...effectiveConfidences) : 0,
    unresolvedLowConfidenceCount: words.filter((word) =>
      (word.effectiveConfidence ?? word.confidence) < 60,
    ).length,
    languagesUsed,
  };
}

function correctKnownChineseConnector(line: OcrLine): void {
  const corrected = line.text.replace(/(准确率|合格率|样本)力(?=\d)/gu, "$1为");
  if (corrected === line.text) return;
  const correctedWord = line.words.find((word) => word.text === "力");
  if (!correctedWord) return;
  correctedWord.text = "为";
  correctedWord.effectiveConfidence = 85;
  correctedWord.verificationMethod = "metric-label-connector-normalization";
  line.text = corrected;
  line.verificationMethod = "metric-label-connector-normalization";
}

function percentValue(value: string): string | null {
  return value.normalize("NFKC").replace(/\s+/gu, "").match(/\d{1,3}(?:\.\d+)?%/u)?.[0] ?? null;
}

async function recognizePercentRegion(
  worker: TesseractWorker,
  image: Buffer,
  rectangle: { left: number; top: number; width: number; height: number },
): Promise<{ value: string; confidence: number } | null> {
  await worker.setParameters({
    tessedit_pageseg_mode: "7",
    tessedit_char_whitelist: "0123456789.%",
    user_defined_dpi: "300",
  });
  const crop = await sharp(image)
    .extract(rectangle)
    .resize({ width: rectangle.width * 4, kernel: "lanczos3" })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();
  const result = await worker.recognize(crop, {}, { blocks: true });
  const value = percentValue((result.data.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => line.text)),
  ).join(" "));
  if (!value) return null;
  const words = (result.data.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)),
  );
  const valueWords = words.filter((word) => /\d/u.test(word.text) && /%/u.test(word.text));
  return { value, confidence: valueWords.length > 0 ? Math.min(...valueWords.map((word) => word.confidence)) : 0 };
}

async function confirmLowConfidenceNumbers(
  lines: OcrLine[],
  image: Buffer,
  imageSize: { width: number; height: number },
  worker: TesseractWorker,
): Promise<boolean> {
  let attempted = false;
  for (const line of lines) {
    for (const word of line.words) {
      if (word.confidence >= 60 || !/\d/u.test(word.text)) continue;
      const expected = numericToken(word.text);
      if (!expected) continue;
      attempted = true;
      const padding = 6;
      const left = Math.max(0, Math.floor(word.bounds.left - padding));
      const top = Math.max(0, Math.floor(word.bounds.top - padding));
      const right = Math.min(imageSize.width, Math.ceil(word.bounds.right + padding));
      const bottom = Math.min(imageSize.height, Math.ceil(word.bounds.bottom + padding));
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: "7",
          tessedit_char_whitelist: "0123456789.%",
          user_defined_dpi: "300",
        });
        const rectangle = { left, top, width: right - left, height: bottom - top };
        const crop = await sharp(image)
          .extract(rectangle)
          .resize({ width: rectangle.width * 3, kernel: "lanczos3" })
          .grayscale()
          .normalize()
          .png()
          .toBuffer();
        const repeated = await worker.recognize(crop, {}, { blocks: true });
        const repeatedText = (repeated.data.blocks ?? []).flatMap((block) =>
          block.paragraphs.flatMap((paragraph) => paragraph.lines.map((item) => item.text)),
        ).join(" ");
        if (numericToken(repeatedText) !== expected) continue;
        const repeatedWords = (repeated.data.blocks ?? []).flatMap((block) =>
          block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((item) => item.words)),
        );
        const repeatedConfidence = repeatedWords.length > 0
          ? Math.min(...repeatedWords.map((item) => item.confidence))
          : 0;
        word.effectiveConfidence = Math.max(85, repeatedConfidence);
        word.secondaryConfidence = repeatedWords.length > 0
          ? Math.min(...repeatedWords.map((item) => item.confidence))
          : 0;
        word.verificationMethod = "independent-numeric-crop-agreement";
        line.verificationMethod = "independent-numeric-crop-agreement";
      } catch {
        continue;
      }
    }
    correctKnownChineseConnector(line);
  }
  return attempted;
}

async function extractHorizontalBarChartValues(
  lines: OcrLine[],
  image: Buffer,
  imageSize: { width: number; height: number },
  worker: TesseractWorker,
): Promise<OcrLine[]> {
  const replacements = new Map<number, OcrLine>();
  const consumed = new Set<number>();
  const datePattern = /(\d{4})\s*年\s*(\d{1,2})\s*月/u;

  for (let dateIndex = 0; dateIndex < lines.length; dateIndex += 1) {
    const dateLine = lines[dateIndex];
    const dateMatch = dateLine?.text.match(datePattern);
    if (!dateLine?.bounds || !dateMatch) continue;
    const candidate = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line, index }) => {
        if (index === dateIndex || !line.bounds) return false;
        const width = line.bounds.right - line.bounds.left;
        const verticalGap = line.bounds.top - dateLine.bounds!.bottom;
        return width >= imageSize.width * 0.4 && verticalGap >= 0 && verticalGap <= imageSize.height * 0.15;
      })
      .sort((left, right) => left.line.bounds!.top - right.line.bounds!.top)[0];
    if (!candidate?.line.bounds) continue;

    const bounds = candidate.line.bounds;
    const lineWidth = bounds.right - bounds.left;
    const left = Math.round(bounds.left + lineWidth * 0.8);
    const rectangle = {
      left,
      top: Math.max(0, Math.floor(bounds.top - 3)),
      width: Math.max(1, Math.ceil(bounds.right - left)),
      height: Math.min(imageSize.height - Math.max(0, Math.floor(bounds.top - 3)),
        Math.ceil(bounds.bottom - bounds.top + 6)),
    };
    const recognized = await recognizePercentRegion(worker, image, rectangle).catch(() => null);
    if (!recognized || recognized.confidence < 60) continue;

    const month = Number(dateMatch[2]);
    const valueWord: OcrWord = {
      text: recognized.value,
      confidence: recognized.confidence,
      effectiveConfidence: recognized.confidence,
      bounds: {
        left: rectangle.left,
        top: rectangle.top,
        right: rectangle.left + rectangle.width,
        bottom: rectangle.top + rectangle.height,
      },
      secondaryConfidence: recognized.confidence,
      verificationMethod: "chart-label-linked-numeric-crop",
    };
    const words = [...dateLine.words, valueWord];
    replacements.set(candidate.index, {
      text: `${dateMatch[1]}年${month}月：${recognized.value}`,
      rawText: candidate.line.rawText ?? candidate.line.text,
      confidence: Math.min(dateLine.confidence, recognized.confidence),
      minimumWordConfidence: Math.min(dateLine.minimumWordConfidence, recognized.confidence),
      bounds: mergeBounds(words),
      words,
      verificationMethod: "chart-label-linked-numeric-crop",
    });
    consumed.add(candidate.index);
  }

  return lines.flatMap((line, index) => consumed.has(index) ? [replacements.get(index)!] : [line]);
}

export class TesseractChineseOcrProvider implements ImageOcrProvider {
  async recognize(image: Uint8Array): Promise<OcrResult> {
    const runtime = requireFromProject("tesseract.js") as TesseractRuntime;
    const chineseDataPath = dirname(requireFromProject.resolve("@tesseract.js-data/chi_sim/package.json"));
    const workerPath = requireFromProject.resolve("tesseract.js/src/worker-script/node/index.js");
    const worker = await runtime.createWorker("chi_sim", 1, {
      langPath: join(chineseDataPath, "4.0.0"),
      workerPath,
      gzip: true,
      cacheMethod: "none",
    });
    const englishWorkerRef: { current: TesseractWorker | null } = { current: null };
    const getEnglishWorker = async (): Promise<TesseractWorker> => {
      if (englishWorkerRef.current) return englishWorkerRef.current;
      const englishDataPath = dirname(requireFromProject.resolve("@tesseract.js-data/eng/package.json"));
      englishWorkerRef.current = await runtime.createWorker("eng", 1, {
        langPath: join(englishDataPath, "4.0.0"),
        workerPath,
        gzip: true,
        cacheMethod: "none",
      });
      return englishWorkerRef.current;
    };

    try {
      const buffer = Buffer.from(image);
      const imageMetadata = await sharp(buffer).metadata();
      const imageSize = { width: imageMetadata.width ?? 0, height: imageMetadata.height ?? 0 };
      const primaryPage = (await worker.recognize(buffer, {}, { blocks: true })).data;
      let lines = linesFromPage(primaryPage);
      const primaryText = lines.map((line) => line.text).join(" ");
      const languagesUsed = ["chi_sim"];

      if (/[A-Za-z]{3,}/u.test(primaryText) && !/\p{Script=Han}{2,}/u.test(primaryText)) {
        try {
          const english = await getEnglishWorker();
          const englishPage = (await english.recognize(buffer, {}, { blocks: true })).data;
          const englishLines = linesFromPage(englishPage);
          const englishText = englishLines.map((line) => line.text).join(" ");
          if (englishLines.length > 0 && /[A-Za-z]{3,}/u.test(englishText)) {
            const englishScore = englishLines.reduce((sum, line) => sum + line.confidence, 0) / englishLines.length;
            const primaryScore = lines.reduce((sum, line) => sum + line.confidence, 0) / Math.max(1, lines.length);
            if (englishScore >= primaryScore) {
              lines = englishLines;
              languagesUsed.splice(0, languagesUsed.length, "eng");
            }
          }
        } catch {
          // Keep the Chinese OCR result and its confidence warnings if English data is unavailable.
        }
      }

      const needsEnglishNumbers = lines.some((line) =>
        line.words.some((word) => word.confidence < 60 && /\d/u.test(word.text)),
      );
      const hasHorizontalChartLabels = lines.some((line) =>
        /(\d{4})\s*年\s*\d{1,2}\s*月/u.test(line.text),
      ) && lines.some((line) => line.bounds && imageSize.width > 0 &&
        line.bounds.right - line.bounds.left >= imageSize.width * 0.4);

      if (needsEnglishNumbers || hasHorizontalChartLabels) {
        try {
          const english = await getEnglishWorker();
          await confirmLowConfidenceNumbers(lines, buffer, imageSize, english);
          if (hasHorizontalChartLabels) {
            lines = await extractHorizontalBarChartValues(lines, buffer, imageSize, english);
            if (lines.some((line) => line.verificationMethod === "chart-label-linked-numeric-crop")) {
              languagesUsed.push("eng");
            }
          }
          if (lines.some((line) => line.verificationMethod === "independent-numeric-crop-agreement")) {
            languagesUsed.push("eng");
          }
        } catch {
          // Low-confidence content remains review-blocked when the secondary OCR pass is unavailable.
        }
      }

      return rebuildOcrResult(lines, [...new Set(languagesUsed)]);
    } finally {
      await worker.terminate();
      if (englishWorkerRef.current) await englishWorkerRef.current.terminate();
    }
  }
}
