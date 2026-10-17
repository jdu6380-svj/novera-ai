import { createHash } from "node:crypto";

import type { JsonObject } from "@/domain";

import type {
  NormalizedContentBlock,
  NormalizedDocument,
  NormalizedSection,
} from "./normalizer";
import { mergeSourceLocators } from "./normalizer";
import type {
  ParsedBlockKind,
  ParsedSourceDocument,
  SourceLocator,
} from "./parser";

export interface KnowledgeChunkSourceSegment {
  sourceBlockId: string;
  kind: ParsedBlockKind;
  normalizedText: string;
  sourceBlockText: string;
  normalizedStartChar: number;
  normalizedEndChar: number;
  locator: SourceLocator;
}

export interface KnowledgeChunk {
  documentId: string;
  sourceDocument: ParsedSourceDocument;
  chunkIndex: number;
  /** Heading context plus chunk content; this is the embedding-ready text. */
  text: string;
  /** Body text without the injected heading path. */
  contentText: string;
  textHash: string;
  tokenCount: number;
  sectionId: string;
  sectionTitle: string;
  sectionLevel: number;
  sectionPath: string[];
  parentSectionId: string | null;
  locator: SourceLocator;
  sourceSegments: KnowledgeChunkSourceSegment[];
  metadata: JsonObject;
}

export interface StructuredChunkerOptions {
  maxTokens?: number;
  overlapTokens?: number;
  includeSectionContext?: boolean;
}

export type DocumentChunkingErrorCode =
  | "INVALID_CHUNK_CONFIGURATION"
  | "NO_CHUNKABLE_CONTENT";

export class DocumentChunkingError extends Error {
  constructor(
    readonly code: DocumentChunkingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentChunkingError";
  }
}

interface TextToken {
  text: string;
  start: number;
  end: number;
}

interface BlockSpan {
  block: NormalizedContentBlock;
  start: number;
  end: number;
}

interface SectionBody {
  text: string;
  spans: BlockSpan[];
}

const DEFAULT_MAX_TOKENS = 400;
const DEFAULT_OVERLAP_TOKENS = 60;
const TOKENIZER_NAME = "unicode-lexical-v1";

function tokenize(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  const tokenPattern =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}_]+(?:['’_-][\p{L}\p{N}_]+)*|[^\s]/gu;

  for (const match of text.matchAll(tokenPattern)) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return tokens;
}

/** Deterministic MVP estimator; the provider tokenizer may report different usage. */
export function estimateTokenCount(text: string): number {
  return tokenize(text).length;
}

function truncateToTokenCount(text: string, maxTokens: number): string {
  const tokens = tokenize(text);

  if (tokens.length <= maxTokens) {
    return text;
  }

  const lastToken = tokens[Math.max(0, maxTokens - 1)];
  return lastToken ? text.slice(0, lastToken.end).trim() : "";
}

function buildSectionBody(section: NormalizedSection): SectionBody {
  let text = "";
  const spans: BlockSpan[] = [];

  for (const block of section.blocks) {
    if (text) {
      text += "\n\n";
    }

    const start = text.length;
    text += block.text;
    spans.push({ block, start, end: text.length });
  }

  return { text, spans };
}

function chooseWindowEnd(
  body: string,
  tokens: readonly TextToken[],
  start: number,
  hardEnd: number,
): number {
  if (hardEnd >= tokens.length) {
    return tokens.length;
  }

  const minimumEnd = start + Math.max(1, Math.floor((hardEnd - start) * 0.6));

  for (let candidate = hardEnd; candidate > minimumEnd; candidate -= 1) {
    const previous = tokens[candidate - 1];
    const next = tokens[candidate];

    if (!previous || !next) {
      continue;
    }

    const gap = body.slice(previous.end, next.start);

    if (gap.includes("\n\n") || /[.!?。！？;；]$/u.test(previous.text)) {
      return candidate;
    }
  }

  return hardEnd;
}

function sourceSegmentsForWindow(
  body: string,
  spans: readonly BlockSpan[],
  windowStart: number,
  windowEnd: number,
): KnowledgeChunkSourceSegment[] {
  const segments: KnowledgeChunkSourceSegment[] = [];

  for (const span of spans) {
    const intersectionStart = Math.max(windowStart, span.start);
    const intersectionEnd = Math.min(windowEnd, span.end);

    if (intersectionStart >= intersectionEnd) {
      continue;
    }

    const normalizedText = body.slice(intersectionStart, intersectionEnd).trim();

    if (!normalizedText) {
      continue;
    }

    segments.push({
      sourceBlockId: span.block.sourceBlockId,
      kind: span.block.kind,
      normalizedText,
      sourceBlockText: span.block.sourceText,
      normalizedStartChar: Math.max(0, intersectionStart - span.start),
      normalizedEndChar: Math.min(span.block.text.length, intersectionEnd - span.start),
      locator: { ...span.block.locator },
    });
  }

  return segments;
}

function mergedSegmentLocator(
  segments: readonly KnowledgeChunkSourceSegment[],
  fallback: SourceLocator,
): SourceLocator {
  if (segments.length === 0) {
    return { ...fallback };
  }

  return segments.reduce<SourceLocator>(
    (locator, segment) => mergeSourceLocators(locator, segment.locator),
    { ...segments[0]!.locator },
  );
}

function headingOnlySegment(section: NormalizedSection): KnowledgeChunkSourceSegment[] {
  if (!section.headingSourceBlockId || !section.headingLocator) {
    return [];
  }

  return [
    {
      sourceBlockId: section.headingSourceBlockId,
      kind: "heading",
      normalizedText: section.title,
      sourceBlockText: section.headingSourceText ?? section.title,
      normalizedStartChar: 0,
      normalizedEndChar: section.title.length,
      locator: { ...section.headingLocator },
    },
  ];
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export class StructuredDocumentChunker {
  readonly name = "novera-structured-chunker";
  readonly version = "1.0.0";
  private readonly maxTokens: number;
  private readonly overlapTokens: number;
  private readonly includeSectionContext: boolean;

  constructor(options: StructuredChunkerOptions = {}) {
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.overlapTokens = options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
    this.includeSectionContext = options.includeSectionContext ?? true;

    if (
      !Number.isInteger(this.maxTokens) ||
      this.maxTokens < 2 ||
      !Number.isInteger(this.overlapTokens) ||
      this.overlapTokens < 0 ||
      this.overlapTokens >= this.maxTokens
    ) {
      throw new DocumentChunkingError(
        "INVALID_CHUNK_CONFIGURATION",
        "maxTokens must be at least 2 and overlapTokens must be between 0 and maxTokens - 1.",
      );
    }
  }

  chunk(document: NormalizedDocument): KnowledgeChunk[] {
    const chunks: KnowledgeChunk[] = [];

    for (const section of document.sections) {
      const body = buildSectionBody(section);
      const rawContext = this.includeSectionContext ? section.path.join(" > ") : "";
      const contextBudget = Math.max(1, Math.floor(this.maxTokens * 0.25));
      const context = truncateToTokenCount(rawContext, contextBudget);
      const contextTokenCount = estimateTokenCount(context);
      const bodyBudget = Math.max(1, this.maxTokens - contextTokenCount);
      const bodyTokens = tokenize(body.text);

      if (bodyTokens.length === 0) {
        const headingSegments = headingOnlySegment(section);

        if (!context || headingSegments.length === 0) {
          continue;
        }

        chunks.push(
          this.createChunk({
            document,
            section,
            chunkIndex: chunks.length,
            text: context,
            contentText: section.title,
            locator: section.locator,
            sourceSegments: headingSegments,
          }),
        );
        continue;
      }

      let startToken = 0;

      while (startToken < bodyTokens.length) {
        const hardEnd = Math.min(startToken + bodyBudget, bodyTokens.length);
        const endToken = chooseWindowEnd(body.text, bodyTokens, startToken, hardEnd);
        const firstToken = bodyTokens[startToken];
        const lastToken = bodyTokens[endToken - 1];

        if (!firstToken || !lastToken) {
          break;
        }

        const windowStart = firstToken.start;
        const windowEnd = lastToken.end;
        const contentText = body.text.slice(windowStart, windowEnd).trim();
        const text = context ? `${context}\n\n${contentText}` : contentText;
        const sourceSegments = sourceSegmentsForWindow(
          body.text,
          body.spans,
          windowStart,
          windowEnd,
        );

        chunks.push(
          this.createChunk({
            document,
            section,
            chunkIndex: chunks.length,
            text,
            contentText,
            locator: mergedSegmentLocator(sourceSegments, section.locator),
            sourceSegments,
          }),
        );

        if (endToken >= bodyTokens.length) {
          break;
        }

        const effectiveOverlap = Math.min(
          this.overlapTokens,
          Math.max(0, endToken - startToken - 1),
        );
        startToken = Math.max(startToken + 1, endToken - effectiveOverlap);
      }
    }

    if (chunks.length === 0) {
      throw new DocumentChunkingError(
        "NO_CHUNKABLE_CONTENT",
        "The normalized document does not contain chunkable content.",
      );
    }

    return chunks;
  }

  private createChunk(input: {
    document: NormalizedDocument;
    section: NormalizedSection;
    chunkIndex: number;
    text: string;
    contentText: string;
    locator: SourceLocator;
    sourceSegments: KnowledgeChunkSourceSegment[];
  }): KnowledgeChunk {
    return {
      documentId: input.document.source.documentId,
      sourceDocument: input.document.source,
      chunkIndex: input.chunkIndex,
      text: input.text,
      contentText: input.contentText,
      textHash: hashText(input.text),
      tokenCount: estimateTokenCount(input.text),
      sectionId: input.section.id,
      sectionTitle: input.section.title,
      sectionLevel: input.section.level,
      sectionPath: [...input.section.path],
      parentSectionId: input.section.parentSectionId,
      locator: { ...input.locator },
      sourceSegments: input.sourceSegments,
      metadata: {
        source: {
          displayName: input.document.source.displayName,
          mimeType: input.document.source.mimeType,
          fileExtension: input.document.source.fileExtension,
        },
        section: {
          id: input.section.id,
          title: input.section.title,
          level: input.section.level,
          path: input.section.path,
          parentSectionId: input.section.parentSectionId,
        },
        chunker: {
          name: this.name,
          version: this.version,
          tokenizer: TOKENIZER_NAME,
          maxTokens: this.maxTokens,
          overlapTokens: this.overlapTokens,
        },
      },
    };
  }
}

const defaultChunker = new StructuredDocumentChunker();

export function chunkDocument(
  document: NormalizedDocument,
  options?: StructuredChunkerOptions,
): KnowledgeChunk[] {
  return options
    ? new StructuredDocumentChunker(options).chunk(document)
    : defaultChunker.chunk(document);
}
