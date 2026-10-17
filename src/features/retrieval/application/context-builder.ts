import type { JsonObject, UUID } from "@/domain";
import { estimateTokenCount } from "@/features/knowledge-processing/content/chunker";

export interface ContextSourceLocator {
  pageStart?: number | null;
  pageEnd?: number | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  startChar?: number | null;
  endChar?: number | null;
  sectionPath?: string | string[] | null;
}

/**
 * Structural input contract for the Context Builder. The Retriever's public
 * result can be passed directly when it exposes these evidence-ready fields.
 */
export interface ContextSourceChunk {
  chunkId: UUID;
  documentId: UUID;
  documentName: string;
  chunkIndex: number;
  text: string;
  similarityScore: number;
  metadata: JsonObject;
  locator: ContextSourceLocator;
  tokenCount?: number | null;
}

export interface ContextBuilderConfig {
  minimumSimilarity: number;
  maxChunks: number;
  maxChunksPerDocument: number;
  maxTokens: number;
  maxCharacters: number;
}

export type ContextBuilderOptions = Partial<ContextBuilderConfig>;

export interface PromptContextChunk extends ContextSourceChunk {
  rank: number;
  citationLabel: string;
  contextText: string;
  renderedText: string;
  estimatedContextTokens: number;
  truncated: boolean;
}

export interface ContextBuildStats {
  received: number;
  selected: number;
  estimatedTokens: number;
  characters: number;
  truncated: number;
  dropped: {
    invalid: number;
    belowThreshold: number;
    duplicate: number;
    perDocumentLimit: number;
    maxChunks: number;
    budget: number;
  };
}

export interface BuiltPromptContext {
  context: string;
  chunks: PromptContextChunk[];
  stats: ContextBuildStats;
  config: ContextBuilderConfig;
}

export type ContextBuilderErrorCode = "INVALID_CONTEXT_CONFIG";

export class ContextBuilderError extends Error {
  constructor(
    readonly code: ContextBuilderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContextBuilderError";
  }
}

const DEFAULT_CONFIG: ContextBuilderConfig = {
  minimumSimilarity: 0.35,
  maxChunks: 8,
  maxChunksPerDocument: 3,
  maxTokens: 2_400,
  maxCharacters: 12_000,
};

function validateConfig(config: ContextBuilderConfig): ContextBuilderConfig {
  if (
    !Number.isFinite(config.minimumSimilarity) ||
    config.minimumSimilarity < -1 ||
    config.minimumSimilarity > 1
  ) {
    throw new ContextBuilderError(
      "INVALID_CONTEXT_CONFIG",
      "minimumSimilarity must be a finite number between -1 and 1.",
    );
  }

  for (const [key, value] of Object.entries({
    maxChunks: config.maxChunks,
    maxChunksPerDocument: config.maxChunksPerDocument,
    maxTokens: config.maxTokens,
    maxCharacters: config.maxCharacters,
  })) {
    if (!Number.isInteger(value) || value < 1) {
      throw new ContextBuilderError(
        "INVALID_CONTEXT_CONFIG",
        `${key} must be a positive integer.`,
      );
    }
  }

  return { ...config };
}

function resolveConfig(
  base: ContextBuilderConfig,
  overrides: ContextBuilderOptions = {},
): ContextBuilderConfig {
  return validateConfig({ ...base, ...overrides });
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidCandidate(candidate: ContextSourceChunk): boolean {
  return (
    isNonBlankString(candidate.chunkId) &&
    isNonBlankString(candidate.documentId) &&
    isNonBlankString(candidate.documentName) &&
    Number.isInteger(candidate.chunkIndex) &&
    candidate.chunkIndex >= 0 &&
    isNonBlankString(candidate.text) &&
    Number.isFinite(candidate.similarityScore) &&
    candidate.similarityScore >= -1 &&
    candidate.similarityScore <= 1 &&
    candidate.metadata !== null &&
    typeof candidate.metadata === "object" &&
    !Array.isArray(candidate.metadata) &&
    candidate.locator !== null &&
    typeof candidate.locator === "object" &&
    !Array.isArray(candidate.locator)
  );
}

function normalizedTextKey(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

function compareCandidates(left: ContextSourceChunk, right: ContextSourceChunk): number {
  if (left.similarityScore !== right.similarityScore) {
    return right.similarityScore - left.similarityScore;
  }

  const documentComparison = left.documentId.localeCompare(right.documentId);

  if (documentComparison !== 0) {
    return documentComparison;
  }

  if (left.chunkIndex !== right.chunkIndex) {
    return left.chunkIndex - right.chunkIndex;
  }

  return left.chunkId.localeCompare(right.chunkId);
}

function formatRange(
  label: string,
  start: number | null | undefined,
  end: number | null | undefined,
): string | null {
  if (start === null || start === undefined) {
    return null;
  }

  if (end === null || end === undefined || end === start) {
    return `${label} ${start}`;
  }

  return `${label} ${start}-${end}`;
}

export function formatSourceLocator(locator: ContextSourceLocator): string {
  const components: string[] = [];
  const sectionPath = Array.isArray(locator.sectionPath)
    ? locator.sectionPath.filter(isNonBlankString).join(" > ")
    : locator.sectionPath?.trim();

  if (sectionPath) {
    components.push(`section ${sectionPath}`);
  }

  const pageRange = formatRange("page", locator.pageStart, locator.pageEnd);
  const lineRange = formatRange("line", locator.lineStart, locator.lineEnd);
  const characterRange = formatRange("chars", locator.startChar, locator.endChar);

  if (pageRange) {
    components.push(pageRange);
  }

  if (lineRange) {
    components.push(lineRange);
  }

  if (characterRange) {
    components.push(characterRange);
  }

  return components.length > 0 ? components.join(" | ") : "location unavailable";
}

function renderContextBlock(
  candidate: ContextSourceChunk,
  citationLabel: string,
  contextText: string,
): string {
  return [
    citationLabel,
    `Source: ${candidate.documentName}`,
    `Trace: document_id=${candidate.documentId}; chunk_id=${candidate.chunkId}; chunk_index=${candidate.chunkIndex}`,
    `Location: ${formatSourceLocator(candidate.locator)}`,
    "Content:",
    contextText,
  ].join("\n");
}

function appendBlock(context: string, block: string): string {
  return context ? `${context}\n\n${block}` : block;
}

function fitsBudget(context: string, config: ContextBuilderConfig): boolean {
  return (
    context.length <= config.maxCharacters &&
    estimateTokenCount(context) <= config.maxTokens
  );
}

interface FittedBlock {
  contextText: string;
  renderedText: string;
  nextContext: string;
  truncated: boolean;
}

function fitBlockToBudget(
  currentContext: string,
  candidate: ContextSourceChunk,
  citationLabel: string,
  config: ContextBuilderConfig,
): FittedBlock | null {
  const contextText = candidate.text.trim();
  const renderedText = renderContextBlock(candidate, citationLabel, contextText);
  const nextContext = appendBlock(currentContext, renderedText);

  if (fitsBudget(nextContext, config)) {
    return { contextText, renderedText, nextContext, truncated: false };
  }

  const suffix = " … [truncated]";
  let low = 1;
  let high = contextText.length;
  let best: FittedBlock | null = null;

  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    const prefix = contextText.slice(0, midpoint).trimEnd();

    if (!prefix) {
      low = midpoint + 1;
      continue;
    }

    const truncatedText = `${prefix}${suffix}`;
    const truncatedRenderedText = renderContextBlock(
      candidate,
      citationLabel,
      truncatedText,
    );
    const truncatedContext = appendBlock(currentContext, truncatedRenderedText);

    if (fitsBudget(truncatedContext, config)) {
      best = {
        contextText: truncatedText,
        renderedText: truncatedRenderedText,
        nextContext: truncatedContext,
        truncated: true,
      };
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }

  return best;
}

function cloneLocator(locator: ContextSourceLocator): ContextSourceLocator {
  return {
    ...locator,
    sectionPath: Array.isArray(locator.sectionPath)
      ? [...locator.sectionPath]
      : locator.sectionPath,
  };
}

/**
 * Converts retrieved evidence into a bounded, citation-addressable prompt
 * context. It never mutates or blindly forwards the complete retrieval set.
 */
export class ContextBuilder {
  private readonly config: ContextBuilderConfig;

  constructor(options: ContextBuilderOptions = {}) {
    this.config = resolveConfig(DEFAULT_CONFIG, options);
  }

  build(
    candidates: readonly ContextSourceChunk[],
    overrides: ContextBuilderOptions = {},
  ): BuiltPromptContext {
    const config = resolveConfig(this.config, overrides);
    const dropped = {
      invalid: 0,
      belowThreshold: 0,
      duplicate: 0,
      perDocumentLimit: 0,
      maxChunks: 0,
      budget: 0,
    };

    const eligible: ContextSourceChunk[] = [];

    for (const candidate of candidates) {
      if (!isValidCandidate(candidate)) {
        dropped.invalid += 1;
        continue;
      }

      if (candidate.similarityScore < config.minimumSimilarity) {
        dropped.belowThreshold += 1;
        continue;
      }

      eligible.push(candidate);
    }

    eligible.sort(compareCandidates);

    const unique: ContextSourceChunk[] = [];
    const seenChunkIds = new Set<string>();
    const seenTexts = new Set<string>();

    for (const candidate of eligible) {
      const textKey = normalizedTextKey(candidate.text);

      if (seenChunkIds.has(candidate.chunkId) || seenTexts.has(textKey)) {
        dropped.duplicate += 1;
        continue;
      }

      seenChunkIds.add(candidate.chunkId);
      seenTexts.add(textKey);
      unique.push(candidate);
    }

    const capped: ContextSourceChunk[] = [];
    const perDocumentCounts = new Map<string, number>();

    for (const candidate of unique) {
      const count = perDocumentCounts.get(candidate.documentId) ?? 0;

      if (count >= config.maxChunksPerDocument) {
        dropped.perDocumentLimit += 1;
        continue;
      }

      perDocumentCounts.set(candidate.documentId, count + 1);
      capped.push(candidate);
    }

    if (capped.length > config.maxChunks) {
      dropped.maxChunks = capped.length - config.maxChunks;
      capped.length = config.maxChunks;
    }

    let context = "";
    const chunks: PromptContextChunk[] = [];

    for (const candidate of capped) {
      const citationLabel = `[S${chunks.length + 1}]`;
      const fitted = fitBlockToBudget(context, candidate, citationLabel, config);

      if (!fitted) {
        dropped.budget += 1;
        continue;
      }

      context = fitted.nextContext;
      chunks.push({
        ...candidate,
        metadata: { ...candidate.metadata },
        locator: cloneLocator(candidate.locator),
        rank: chunks.length + 1,
        citationLabel,
        contextText: fitted.contextText,
        renderedText: fitted.renderedText,
        estimatedContextTokens: estimateTokenCount(fitted.renderedText),
        truncated: fitted.truncated,
      });
    }

    return {
      context,
      chunks,
      stats: {
        received: candidates.length,
        selected: chunks.length,
        estimatedTokens: estimateTokenCount(context),
        characters: context.length,
        truncated: chunks.filter((chunk) => chunk.truncated).length,
        dropped,
      },
      config,
    };
  }
}

export function buildPromptContext(
  candidates: readonly ContextSourceChunk[],
  options: ContextBuilderOptions = {},
): BuiltPromptContext {
  return new ContextBuilder(options).build(candidates);
}
