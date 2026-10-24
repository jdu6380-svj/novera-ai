import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import OpenAI from "openai";

import type { JsonObject, JsonValue, UUID } from "@/domain";
import { AnswerGenerator } from "@/features/qa/application/answer-generator";
import { EvidenceVerificationLayer } from "@/features/qa/application/evidence-verifier";
import { reviewRequiredExtractionWarnings, reviewWarningsForSources } from "@/features/knowledge-processing/content/extraction-warnings";
import { StructuredDocumentChunker, estimateTokenCount, type KnowledgeChunk } from "@/features/knowledge-processing/content/chunker";
import { NormalizerLayer } from "@/features/knowledge-processing/content/normalizer";
import { ParserLayer, type DocumentProcessingSource, type ParsedDocument } from "@/features/knowledge-processing/content/parser";
import { ContextBuilder, type ContextSourceChunk } from "@/features/retrieval/application/context-builder";
import { QueryUnderstandingLayer } from "@/features/retrieval/application/query-understanding";
import { RetrievalEngine } from "@/features/retrieval/application/retrieval-engine";
import { getRetrieverConfig } from "@/features/retrieval/application/retriever-config";
import { RetrieverService } from "@/features/retrieval/application/retriever-service";
import { OpenAIEmbeddingProvider, getEmbeddingConfig, getEmbeddingIdentityConfig, isDashScopeEmbedding, DeepSeekLanguageModelProvider, getLanguageModelConfig, getLanguageModelIdentityConfig, OpenAILanguageModelProvider } from "@/infrastructure/ai";
import { DEFAULT_KNOWLEDGE_BASE_ID } from "@/domain/primitives";
import type { EmbeddingProvider } from "@/providers";
import { LocalVectorIndex } from "./local-vector-index";
import { expandBilingualRetrievalQuery } from "@/features/retrieval/application/retrieval-query-expansion";
import { evaluateCaseResult, type EvaluationExpectation } from "./scoring";
import { evaluateCaseResultV2, type V2CasePolicy, type V2Expectation } from "./scoring.v2";
import { evaluateCaseResultV3, type V3CasePolicy } from "./scoring.v3";

const ROOT = path.resolve(process.cwd(), "evals/document-reliability");
const FIXTURES = path.join(ROOT, "fixtures");
const RUNS = path.join(ROOT, "runs");
const MAX_OUTPUT_TOKENS = 512;
const DEEPSEEK_MAX_INPUT_TOKENS_PER_CASE = 4_000;
const DEEPSEEK_CONTEXT_TOKENS = 2_400;
const DEEPSEEK_INPUT_USD_PER_MILLION = 0.3;
const DEEPSEEK_OUTPUT_USD_PER_MILLION = 1.2;
const DASHSCOPE_CNY_PER_THOUSAND = 0.0007;
const GENERATION_SMOKE_SOURCE_RUN = "2026-10-23T15-40-53-826Z-smoke.json";
const SAFE_ENV_KEYS = new Set([
  "EMBEDDING_PROVIDER",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIMENSION",
  "EMBEDDING_BATCH_SIZE",
  "EMBEDDING_BASE_URL",
  "OPENAI_BASE_URL",
  "LANGUAGE_MODEL_PROVIDER",
  "LANGUAGE_MODEL",
  "LANGUAGE_MODEL_MAX_OUTPUT_TOKENS",
  "DEEPSEEK_BASE_URL",
]);
const execFileAsync = promisify(execFile);

const EVALUATION_SOURCE_FILES = [
  "evals/document-reliability/acceptance.v2.json",
  "evals/document-reliability/real-rag-runner.ts",
  "evals/document-reliability/scoring.v2.ts",
  "evals/document-reliability/local-vector-index.ts",
  "src/features/knowledge-processing/content/parser.ts",
  "src/features/knowledge-processing/content/ooxml-parser.ts",
  "src/features/knowledge-processing/content/image-ocr.ts",
  "src/features/knowledge-processing/content/chunker.ts",
  "src/features/knowledge-processing/content/normalizer.ts",
  "src/features/knowledge-processing/content/extraction-warnings.ts",
  "src/features/retrieval/application/retriever-service.ts",
  "src/features/retrieval/application/retrieval-query-expansion.ts",
  "src/features/retrieval/application/retrieval-engine.ts",
  "src/features/retrieval/application/context-builder.ts",
  "src/features/qa/application/answer-generator.ts",
  "src/features/qa/application/evidence-verifier.ts",
  "src/infrastructure/ai/openai-language-model-provider.ts",
];

const EVALUATION_SOURCE_FILES_V3 = [
  "evals/document-reliability/acceptance.v3.json",
  "evals/document-reliability/real-rag-runner.ts",
  "evals/document-reliability/scoring.v3.ts",
  "evals/document-reliability/scoring.v2.ts",
  "evals/document-reliability/local-vector-index.ts",
  "src/features/knowledge-processing/content/parser.ts",
  "src/features/knowledge-processing/content/ooxml-parser.ts",
  "src/features/knowledge-processing/content/image-ocr.ts",
  "src/features/knowledge-processing/content/chunker.ts",
  "src/features/knowledge-processing/content/normalizer.ts",
  "src/features/knowledge-processing/content/extraction-warnings.ts",
  "src/features/retrieval/application/retriever-service.ts",
  "src/features/retrieval/application/retrieval-query-expansion.ts",
  "src/features/retrieval/application/retrieval-engine.ts",
  "src/features/retrieval/application/context-builder.ts",
  "src/features/qa/application/answer-generator.ts",
  "src/features/qa/application/evidence-verifier.ts",
  "src/infrastructure/ai/openai-language-model-provider.ts",
];

type ManifestDocument = {
  document_id: string;
  file_name: string;
  file_format: string;
  mime_type: string;
  document_hash: string;
};

type ManifestEvidence = {
  document_id: string;
  evidence_text: string;
  evidence_location: string;
};

type ManifestCase = {
  case_id: string;
  document_id: string;
  question: string;
  expected_answer: string;
  answerability: string;
  expected_behavior: string;
  evidence_text: ManifestEvidence[];
};

type Manifest = {
  documents: ManifestDocument[];
  cases: ManifestCase[];
};

type AcceptanceV2 = {
  schema_version: string;
  source_of_truth: Record<string, string>;
  documents: Array<{
    document_id: string;
    v2_profile: string;
  }>;
  cases: V2CasePolicy[];
};

type AcceptanceV3 = {
  schema_version: string;
  source_of_truth: Record<string, string>;
  documents: Array<{ document_id: string; v3_profile: string }>;
  cases: V3CasePolicy[];
};

type RuntimeCase = Pick<ManifestCase, "case_id" | "document_id" | "question">;

type PreparedDocument = {
  manifest: ManifestDocument;
  sourceId: UUID;
  parsed: ParsedDocument;
  chunks: KnowledgeChunk[];
  eligibleChunks: KnowledgeChunk[];
  excludedChunkIndexes: number[];
  warnings: JsonObject[];
  reviewRequired: boolean;
  parserStatus: "PASS" | "PARTIAL";
};

function stableUuid(value: string): UUID {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  digest[12] = "5";
  digest[16] = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sourceFor(document: ManifestDocument, content: Uint8Array): DocumentProcessingSource {
  return {
    documentId: stableUuid(document.document_id),
    displayName: document.file_name,
    mimeType: document.mime_type,
    fileExtension: path.extname(document.file_name).slice(1),
    metadata: { sourceType: "synthetic" },
    content,
  };
}

function jsonObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(path.join(ROOT, "manifest.v1.json"), "utf8")) as Manifest;
}

async function readAcceptanceV2(): Promise<{ acceptance: AcceptanceV2; sha256: string }> {
  const bytes = await readFile(path.join(ROOT, "acceptance.v2.json"));
  const acceptance = JSON.parse(bytes.toString("utf8")) as AcceptanceV2;
  for (const [fileKey, hashKey] of [
    ["corpus_spec", "corpus_spec_sha256"],
    ["manifest", "manifest_sha256"],
    ["actual_results", "actual_results_sha256"],
    ["original_full_run", "original_full_run_sha256"],
  ]) {
    const fileName = acceptance.source_of_truth[fileKey];
    const expectedHash = acceptance.source_of_truth[hashKey];
    if (!fileName || !expectedHash) throw new Error(`Acceptance v2 source pin is missing: ${fileKey}.`);
    const sourceBytes = await readFile(path.join(ROOT, fileName));
    const actualHash = createHash("sha256").update(sourceBytes).digest("hex");
    if (actualHash !== expectedHash) throw new Error(`Acceptance v2 source hash mismatch: ${fileKey}.`);
  }
  return { acceptance, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function readAcceptanceV3(): Promise<{ acceptance: AcceptanceV3; sha256: string }> {
  const bytes = await readFile(path.join(ROOT, "acceptance.v3.json"));
  const acceptance = JSON.parse(bytes.toString("utf8")) as AcceptanceV3;
  if (acceptance.schema_version !== "3.0.0") throw new Error("Acceptance v3 schema version is invalid.");
  for (const [fileKey, hashKey] of [
    ["corpus_spec", "corpus_spec_sha256"],
    ["manifest", "manifest_sha256"],
    ["actual_results", "actual_results_sha256"],
    ["original_full_run", "original_full_run_sha256"],
    ["parent_acceptance_v2", "parent_acceptance_v2_sha256"],
  ]) {
    const fileName = acceptance.source_of_truth[fileKey];
    const expectedHash = acceptance.source_of_truth[hashKey];
    if (!fileName || !expectedHash) throw new Error(`Acceptance v3 source pin is missing: ${fileKey}.`);
    const sourceBytes = await readFile(path.join(ROOT, fileName));
    const actualHash = createHash("sha256").update(sourceBytes).digest("hex");
    if (actualHash !== expectedHash) throw new Error(`Acceptance v3 source hash mismatch: ${fileKey}.`);
  }
  const documentIds = acceptance.documents.map((item) => item.document_id);
  const caseIds = acceptance.cases.map((item) => item.case_id);
  if (documentIds.length !== 20 || new Set(documentIds).size !== 20) {
    throw new Error("Acceptance v3 must map 20 unique source documents.");
  }
  if (caseIds.length !== 40 || new Set(caseIds).size !== 40) {
    throw new Error("Acceptance v3 must map 40 unique source questions.");
  }
  return { acceptance, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function evaluationSourceFingerprint(): Promise<JsonObject> {
  const hashes: Record<string, string> = {};
  for (const fileName of EVALUATION_SOURCE_FILES) {
    const bytes = await readFile(path.resolve(process.cwd(), fileName));
    hashes[fileName] = createHash("sha256").update(bytes).digest("hex");
  }
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() });
  return {
    git_head: stdout.trim(),
    source_file_sha256: hashes,
  };
}

async function evaluationSourceFingerprintV3(): Promise<JsonObject> {
  const hashes: Record<string, string> = {};
  for (const fileName of EVALUATION_SOURCE_FILES_V3) {
    const bytes = await readFile(path.resolve(process.cwd(), fileName));
    hashes[fileName] = createHash("sha256").update(bytes).digest("hex");
  }
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() });
  return { git_head: stdout.trim(), source_file_sha256: hashes };
}

async function loadSafeLocalModelConfig(): Promise<void> {
  for (const fileName of [".env.development.local", ".env.local", ".env.development", ".env"]) {
    let contents: string;
    try {
      contents = await readFile(path.resolve(process.cwd(), fileName), "utf8");
    } catch {
      continue;
    }
    for (const line of contents.split(/\r?\n/u)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u);
      const key = match?.[1];
      let value = match?.[2] ?? "";
      if (!key || !SAFE_ENV_KEYS.has(key) || process.env[key] !== undefined) continue;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/u, "").trim();
      }
      process.env[key] = value;
    }
  }
}

async function loadRuntimeEnvironmentAfterApproval(): Promise<void> {
  const runtimeEnv = process.env as Record<string, string | undefined>;
  const originalNodeEnv = runtimeEnv.NODE_ENV;
  runtimeEnv.NODE_ENV = "development";
  try {
    const { loadEnvConfig } = await import("@next/env");
    loadEnvConfig(process.cwd(), true);
  } finally {
    if (originalNodeEnv === undefined) delete runtimeEnv.NODE_ENV;
    else runtimeEnv.NODE_ENV = originalNodeEnv;
  }
}

async function prepareCorpus(documentIds?: ReadonlySet<string>): Promise<{
  manifest: Manifest;
  documents: PreparedDocument[];
  runtimeCases: RuntimeCase[];
  specHash: string;
  manifestHash: string;
}> {
  const [manifest, manifestBytes, specBytes] = await Promise.all([
    readManifest(),
    readFile(path.join(ROOT, "manifest.v1.json")),
    readFile(path.join(ROOT, "corpus-spec.v1.json")),
  ]);
  const parser = new ParserLayer();
  const normalizer = new NormalizerLayer();
  const chunker = new StructuredDocumentChunker();
  const documents: PreparedDocument[] = [];

  for (const document of manifest.documents) {
    if (documentIds && !documentIds.has(document.document_id)) continue;
    const content = new Uint8Array(await readFile(path.join(FIXTURES, document.file_name)));
    const actualHash = createHash("sha256").update(content).digest("hex");
    if (actualHash !== document.document_hash) {
      throw new Error(`Fixture hash mismatch for ${document.document_id}.`);
    }
    const parsed = await parser.parse(sourceFor(document, content));
    const warnings = (Array.isArray(parsed.metadata.extractionWarnings)
      ? parsed.metadata.extractionWarnings
      : []).map(jsonObject);
    const reviewRequired = reviewRequiredExtractionWarnings(parsed.metadata).length > 0;
    const normalized = normalizer.normalize(parsed);
    const chunks = chunker.chunk(normalized);
    const reviewWarnings = reviewRequiredExtractionWarnings(parsed.metadata);
    const eligibleChunks = chunks.filter((chunk) => reviewWarningsForSources(
      reviewWarnings,
      chunk.sourceSegments.map((segment) => ({
        pageStart: segment.locator.pageStart,
        pageEnd: segment.locator.pageEnd,
        metadata: segment.metadata,
      })),
    ).length === 0);
    const eligibleIndexes = new Set(eligibleChunks.map((chunk) => chunk.chunkIndex));
    documents.push({
      manifest: document,
      sourceId: stableUuid(document.document_id),
      parsed,
      chunks,
      eligibleChunks,
      excludedChunkIndexes: chunks.filter((chunk) => !eligibleIndexes.has(chunk.chunkIndex)).map((chunk) => chunk.chunkIndex),
      warnings,
      reviewRequired,
      parserStatus: reviewRequired ? "PARTIAL" : "PASS",
    });
  }

  const selectedIds = new Set(documents.map((document) => document.manifest.document_id));
  const selectedCases = manifest.cases
    .filter((item) => !documentIds || selectedIds.has(item.document_id))
    .map(({ case_id, document_id, question }) => ({ case_id, document_id, question }));
  const runtimeCases = documentIds ? selectedCases.slice(0, 1) : selectedCases;

  return {
    manifest,
    documents,
    runtimeCases,
    specHash: createHash("sha256").update(specBytes).digest("hex"),
    manifestHash: createHash("sha256").update(manifestBytes).digest("hex"),
  };
}

function effectiveEmbeddingBatchSize(): number {
  const configured = Number(process.env.EMBEDDING_BATCH_SIZE || 10);
  const safeConfigured = Number.isSafeInteger(configured) && configured > 0 ? configured : 10;
  const identity = getEmbeddingIdentityConfig();
  const baseURL = process.env.EMBEDDING_BASE_URL ?? process.env.OPENAI_BASE_URL;
  return isDashScopeEmbedding(identity.provider, baseURL) && /^text-embedding-v[12]$/i.test(identity.model)
    ? Math.min(safeConfigured, 25)
    : safeConfigured;
}

function estimateCost(input: {
  documents: PreparedDocument[];
  cases: RuntimeCase[];
}): JsonObject {
  const chunkCount = input.documents.reduce((total, document) => total + document.eligibleChunks.length, 0);
  const documentTokens = input.documents.reduce(
    (total, document) => total + document.eligibleChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
    0,
  );
  const queryTokens = input.cases.reduce((total, item) => total + estimateTokenCount(
    expandBilingualRetrievalQuery(item.question).embeddingQueries.join("\n"),
  ), 0);
  const batchSize = effectiveEmbeddingBatchSize();
  const documentEmbeddingRequests = Math.ceil(chunkCount / batchSize);
  const queryEmbeddingRequests = input.cases.reduce((total, item) =>
    total + Math.ceil(expandBilingualRetrievalQuery(item.question).embeddingQueries.length / batchSize), 0);
  const queryEmbeddingVectors = input.cases.reduce((total, item) =>
    total + expandBilingualRetrievalQuery(item.question).embeddingQueries.length, 0);
  const maximumGenerationRequests = input.cases.length;
  const embeddingTokens = documentTokens + queryTokens;
  const deepSeekInputTokens = maximumGenerationRequests * DEEPSEEK_MAX_INPUT_TOKENS_PER_CASE;
  const deepSeekOutputTokens = maximumGenerationRequests * MAX_OUTPUT_TOKENS;
  const deepSeekUsd = (deepSeekInputTokens * DEEPSEEK_INPUT_USD_PER_MILLION +
    deepSeekOutputTokens * DEEPSEEK_OUTPUT_USD_PER_MILLION) / 1_000_000;
  const dashScopeCny = embeddingTokens * DASHSCOPE_CNY_PER_THOUSAND / 1_000;

  return {
    chunk_count: chunkCount,
    document_embedding_tokens_estimate: documentTokens,
    query_embedding_tokens_estimate: queryTokens,
    query_embedding_vector_upper_bound: queryEmbeddingVectors,
    embedding_request_upper_bound: documentEmbeddingRequests + queryEmbeddingRequests,
    document_embedding_request_upper_bound: documentEmbeddingRequests,
    query_embedding_request_upper_bound: queryEmbeddingRequests,
    deepseek_generation_request_upper_bound: maximumGenerationRequests,
    deepseek_input_tokens_upper_bound: deepSeekInputTokens,
    deepseek_output_tokens_upper_bound: deepSeekOutputTokens,
    dashscope_price_cny_per_1k_tokens: DASHSCOPE_CNY_PER_THOUSAND,
    dashscope_estimated_upper_bound_cny: Number(dashScopeCny.toFixed(6)),
    deepseek_peak_price_usd_per_1m_input_tokens: DEEPSEEK_INPUT_USD_PER_MILLION,
    deepseek_peak_price_usd_per_1m_output_tokens: DEEPSEEK_OUTPUT_USD_PER_MILLION,
    deepseek_estimated_peak_upper_bound_usd: Number(deepSeekUsd.toFixed(6)),
    pricing_note: "Uses full list rates, DeepSeek peak rates, no free quota, and a 4,000-token input/512-token output cap per case.",
  };
}

function estimateReportedUsageCost(input: {
  documentEmbeddingTokens: number;
  queryEmbeddingTokens: number;
  generationInputTokens: number;
  generationOutputTokens: number;
}): JsonObject {
  const embeddingTokens = input.documentEmbeddingTokens + input.queryEmbeddingTokens;
  return {
    dashscope_estimated_cny_from_reported_tokens: Number(
      (embeddingTokens * DASHSCOPE_CNY_PER_THOUSAND / 1_000).toFixed(8),
    ),
    deepseek_estimated_peak_usd_from_reported_tokens: Number((
      input.generationInputTokens * DEEPSEEK_INPUT_USD_PER_MILLION / 1_000_000 +
      input.generationOutputTokens * DEEPSEEK_OUTPUT_USD_PER_MILLION / 1_000_000
    ).toFixed(8)),
    pricing_note: "Estimated from provider-reported token usage at public list/peak rates; this is not an account billing record and excludes any provider-side cache pricing or credits.",
  };
}

function buildPreflight(
  input: Awaited<ReturnType<typeof prepareCorpus>>,
  mode: string,
  acceptanceV2Hash?: string,
): JsonObject {
  const statusCounts = input.documents.reduce<Record<string, number>>((counts, document) => {
    counts[document.parserStatus] = (counts[document.parserStatus] ?? 0) + 1;
    return counts;
  }, {});
  const identity = getEmbeddingIdentityConfig();
  const language = getLanguageModelIdentityConfig();
  return {
    schema_version: "1.0.0",
    mode,
    acceptance_version: mode.endsWith("-v3") ? "3.0.0" : mode.endsWith("-v2") ? "2.0.0" : "1.0.0",
    acceptance_v2_sha256: mode.endsWith("-v2") ? acceptanceV2Hash ?? null : null,
    acceptance_v3_sha256: mode.endsWith("-v3") ? acceptanceV2Hash ?? null : null,
    generated_at: new Date().toISOString(),
    execution_boundary: "Local parser and in-memory vector store only; no Supabase, Storage, auth, database, or business API calls.",
    real_model_calls_executed: false,
    corpus: {
      fixture_count: input.documents.length,
      question_count: input.runtimeCases.length,
      manifest_sha256: input.manifestHash,
      corpus_spec_sha256: input.specHash,
      documents: input.documents.map((document) => ({
        document_id: document.manifest.document_id,
        file_name: document.manifest.file_name,
        sha256: document.manifest.document_hash,
        parser: document.parsed.parser,
        status: document.parserStatus,
        warning_count: document.warnings.length,
        warnings: document.warnings,
        extracted_char_count: document.parsed.charCount,
        chunk_count: document.chunks.length,
        qa_eligible_chunk_count: document.eligibleChunks.length,
        excluded_chunk_indexes: document.excludedChunkIndexes,
        chunk_tokens_estimate: document.chunks.reduce((total, chunk) => total + chunk.tokenCount, 0),
        qa_eligible: document.eligibleChunks.length > 0,
      })),
      parser_status_counts: statusCounts,
      total_chunks: input.documents.reduce((total, document) => total + document.chunks.length, 0),
      qa_eligible_chunks: input.documents
        .reduce((total, document) => total + document.eligibleChunks.length, 0),
    },
    configured_model_identity: {
      embedding_provider: identity.provider,
      embedding_model: identity.model,
      embedding_dimensions: identity.dimensions,
      generation_provider: language.provider,
      generation_model: language.model,
    },
    cost_estimate: estimateCost({ documents: input.documents, cases: input.runtimeCases }),
    unresolved_product_boundary: "Only chunks without applicable review-required warnings enter retrieval. Omitted content remains unavailable until verified; cases requiring it may fail their original criteria.",
  };
}

function safeArtifactName(mode: string): string {
  return `${new Date().toISOString().replace(/[:.]/gu, "-")}-${mode}.json`;
}

async function saveArtifact(mode: string, data: JsonObject): Promise<string> {
  await mkdir(RUNS, { recursive: true });
  const target = path.join(RUNS, safeArtifactName(mode));
  await writeFile(target, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
  return target;
}

function requireApprovedBudget(estimate: JsonObject): { approvedUsd: number; approvedCny: number } {
  if (process.env.NOVERA_DOCUMENT_RAG_COST_APPROVED !== "YES") {
    throw new Error("External model calls are blocked until the user explicitly approves the displayed per-run budget.");
  }
  const approvedUsd = Number(process.env.NOVERA_DOCUMENT_RAG_APPROVED_USD);
  const approvedCny = Number(process.env.NOVERA_DOCUMENT_RAG_APPROVED_CNY);
  const maxUsd = Number(estimate.deepseek_estimated_peak_upper_bound_usd);
  const maxCny = Number(estimate.dashscope_estimated_upper_bound_cny);
  if (!Number.isFinite(approvedUsd) || approvedUsd < maxUsd || !Number.isFinite(approvedCny) || approvedCny < maxCny) {
    throw new Error("Approved budget is missing or below the preflight upper bound; no API request was sent.");
  }
  return { approvedUsd, approvedCny };
}

function requireApprovedModelDestination(input: {
  provider: string;
  model: string;
  baseURL: string | undefined;
  expectedProvider: string;
  expectedModel: string;
  expectedHost: string;
}): void {
  let endpoint: URL;
  try {
    endpoint = new URL(input.baseURL ?? "");
  } catch {
    throw new Error(`The ${input.expectedProvider} endpoint is missing or invalid; no model request was sent.`);
  }
  if (input.provider.toLowerCase() !== input.expectedProvider ||
      input.model !== input.expectedModel ||
      endpoint.protocol !== "https:" ||
      endpoint.hostname !== input.expectedHost ||
      endpoint.username || endpoint.password || endpoint.port) {
    throw new Error(`The ${input.expectedProvider} model identity or endpoint is outside this approved run; no model request was sent.`);
  }
}

function documentAcceptanceStatus(
  document: PreparedDocument,
  profile: string,
): { status: "PASS" | "FAIL"; reason: string } {
  const parserName = String(jsonObject(document.parsed.parser).name ?? "");
  const allChunks = document.chunks.length > 0;
  const eligible = document.eligibleChunks.length;
  const excluded = document.excludedChunkIndexes.length;

  if (profile === "partial_parse_exclude_review_required_ocr_page") {
    const passed = document.reviewRequired && allChunks && eligible > 0 && excluded > 0;
    return { status: passed ? "PASS" : "FAIL", reason: "mixed text/OCR pages keep verified text and exclude review-required page chunks" };
  }
  if (profile === "ocr_parse_partial_exclude_review_required_content" || profile === "ocr_partial_parse_exclude_review_required_content") {
    const passed = parserName === "image-ocr" || parserName === "pdf-parse" && document.reviewRequired;
    const safe = passed && document.reviewRequired && allChunks && eligible === 0 && excluded > 0;
    return { status: safe ? "PASS" : "FAIL", reason: "low-confidence OCR is recorded and excluded from question-answering index" };
  }
  if (profile === "structured_docx_table_rows_with_locators") {
    const passed = parserName === "docx" && document.parserStatus === "PASS" && document.chunks.some((chunk) => chunk.text.includes("Table 1 row 3: 区域=华南"));
    return { status: passed ? "PASS" : "FAIL", reason: "DOCX table rows preserve header/value associations and row provenance" };
  }
  if (profile === "xlsx_structured_rows_with_merge_notice") {
    const passed = parserName === "xlsx" && document.chunks.some((chunk) => /Headers:.*\n\nRow \d+:/u.test(chunk.text));
    return { status: passed ? "PASS" : "FAIL", reason: "XLSX headers and row values are extracted as structured source text" };
  }
  if (profile === "pptx_slide_text_available_chart_cache_excluded") {
    const chartChunksExcluded = document.chunks
      .filter((chunk) => /Chart\s*\(/u.test(chunk.text))
      .every((chunk) => document.excludedChunkIndexes.includes(chunk.chunkIndex));
    const textChunksEligible = document.eligibleChunks.some((chunk) => /^Slide \d+ >/u.test(chunk.text));
    const passed = parserName === "pptx" && document.reviewRequired && chartChunksExcluded && textChunksEligible;
    return { status: passed ? "PASS" : "FAIL", reason: "slide text remains eligible while chart-cache chunks stay review-blocked" };
  }

  const passed = document.parserStatus === "PASS" && allChunks && eligible > 0;
  return { status: passed ? "PASS" : "FAIL", reason: "complete parse has at least one eligible chunk and no review-required parser status" };
}

function documentAcceptanceStatusV3(
  document: PreparedDocument,
  profile: string,
): { status: "PASS" | "FAIL"; reason: string } {
  if (profile !== "complete_ocr_parse_with_verified_target_values") {
    return documentAcceptanceStatus(document, profile);
  }

  const allEligible = document.chunks.length > 0 &&
    document.eligibleChunks.length === document.chunks.length &&
    document.excludedChunkIndexes.length === 0;
  const chunksText = document.chunks.map((chunk) => chunk.text).join("\n");
  const blocks = document.parsed.blocks;
  let targetValuesVerified = false;

  switch (document.manifest.document_id) {
    case "doc-003":
      targetValuesVerified = chunksText.includes("2025 customer return rate was 1.6%.") &&
        blocks.some((block) => block.metadata.extractionMethod === "tesseract-ocr" &&
          block.locator.pageStart === 2 && Number(block.metadata.confidence) >= 85);
      break;
    case "doc-005": {
      const ocrBlocks = blocks.filter((block) => block.metadata.extractionMethod === "tesseract-ocr");
      const hasConfirmedValue = (expected: string) => ocrBlocks.some((block) => {
        const words = Array.isArray(block.metadata.words) ? block.metadata.words.map(jsonObject) : [];
        return words.some((word) => {
          if (word.text !== expected) return false;
          const rawConfidence = Number(word.confidence) || 0;
          if (rawConfidence >= 60) return true;
          return word.verificationMethod === "independent-numeric-crop-agreement" &&
            Number(word.effectiveConfidence) >= 85;
        });
      });
      const confirmedNumericValues = hasConfirmedValue("98.7%") && hasConfirmedValue("620");
      targetValuesVerified = chunksText.includes("库存准确率为98.7%") &&
        chunksText.includes("抽检样本为620件") && confirmedNumericValues &&
        ocrBlocks.some((block) => Number(block.metadata.confidence) >= 85);
      break;
    }
    case "doc-020": {
      const ocrText = blocks.map((block) => block.text).join("\n");
      targetValuesVerified = ocrText.includes("2025年7月：98.4%") &&
        ocrText.includes("2025年8月：99.1%") &&
        blocks.some((block) => block.metadata.verificationMethod === "chart-label-linked-numeric-crop" &&
          block.locator.pageStart === 1 && Number(block.metadata.confidence) >= 85);
      break;
    }
    default:
      targetValuesVerified = false;
  }

  const expectedParser = document.manifest.file_format.toLowerCase() === "png" ? "image-ocr" : "pdf-parse";
  const passed = document.parsed.parser.name === expectedParser &&
    document.parserStatus === "PASS" &&
    !document.reviewRequired &&
    allEligible &&
    targetValuesVerified;
  return {
    status: passed ? "PASS" : "FAIL",
    reason: "OCR values are eligible only after parser confidence checks; low-confidence numeric values require a matching crop pass and the printed chart requires date-linked numeric crop provenance",
  };
}

function retrievalOcrProvenance(chunk: { metadata: JsonObject }): JsonValue[] {
  const evidence = jsonObject(chunk.metadata.evidence);
  const segments = Array.isArray(evidence.sourceSegments) ? evidence.sourceSegments : [];
  return segments.flatMap((value) => {
    const segment = jsonObject(value);
    const metadata = jsonObject(segment.metadata);
    if (metadata.extractionMethod !== "tesseract-ocr") return [];
    const words = Array.isArray(metadata.words) ? metadata.words.map(jsonObject) : [];
    const numericWords = words.filter((word) => typeof word.text === "string" && /\d/u.test(word.text));
    return [jsonValue({
      source_block_id: segment.sourceBlockId,
      text: segment.normalizedText,
      source_block_text: segment.sourceBlockText,
      locator: segment.locator,
      extraction_method: metadata.extractionMethod,
      confidence: metadata.confidence,
      minimum_word_confidence: metadata.minimumWordConfidence,
      verification_method: metadata.verificationMethod ?? null,
      numeric_words: numericWords.map((word) => ({
        text: word.text,
        confidence: word.confidence,
        effective_confidence: word.effectiveConfidence ?? word.confidence,
        verification_method: word.verificationMethod ?? null,
      })),
    })];
  });
}

function retrievalLocator(chunk: KnowledgeChunk) {
  return {
    pageStart: chunk.locator.pageStart,
    pageEnd: chunk.locator.pageEnd,
    lineStart: chunk.locator.lineStart,
    lineEnd: chunk.locator.lineEnd,
    startChar: chunk.locator.startChar,
    endChar: chunk.locator.endChar,
    sectionPath: chunk.sectionPath.join(" > ") || null,
    sourceSegments: chunk.sourceSegments.map((segment) => ({
      sourceBlockId: segment.sourceBlockId,
      pageStart: segment.locator.pageStart,
      pageEnd: segment.locator.pageEnd,
      lineStart: segment.locator.lineStart,
      lineEnd: segment.locator.lineEnd,
      startChar: segment.locator.startChar,
      endChar: segment.locator.endChar,
    })),
  };
}

function safeError(error: unknown): JsonObject {
  const chain: Record<string, unknown>[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const value = current as Record<string, unknown>;
    chain.push(value);
    current = value.cause;
  }
  const diagnostics = chain.map((value) => value.diagnostics)
    .find((value) => typeof value === "object" && value !== null) as Record<string, unknown> | undefined;
  const httpStatus = diagnostics?.status ?? chain.map((value) => value.status).find((value) => typeof value === "number");
  const causeCodeValue = chain.slice(1).map((value) => value.code)
    .find((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,80}$/u.test(value));
  const causeCode = typeof causeCodeValue === "string" ? causeCodeValue : null;
  return {
    name: error instanceof Error ? error.name : "UnknownError",
    code: typeof chain[0]?.code === "string" ? chain[0].code : null,
    cause_code: causeCode,
    http_status: typeof httpStatus === "number" ? httpStatus : null,
    provider_code: typeof diagnostics?.providerCode === "string" && /^[A-Za-z0-9_-]{1,80}$/u.test(diagnostics.providerCode)
      ? diagnostics.providerCode
      : null,
    response_finish_reason: typeof diagnostics?.responseFinishReason === "string"
      ? diagnostics.responseFinishReason
      : null,
    response_content_length: typeof diagnostics?.responseContentLength === "number"
      ? diagnostics.responseContentLength
      : null,
    response_output_tokens: typeof diagnostics?.responseOutputTokens === "number"
      ? diagnostics.responseOutputTokens
      : null,
    response_refusal: typeof diagnostics?.responseRefusal === "boolean"
      ? diagnostics.responseRefusal
      : null,
    response_parse_failure_reason: typeof diagnostics?.responseParseFailureReason === "string"
      ? diagnostics.responseParseFailureReason
      : null,
    detail: "Raw provider messages and request headers are intentionally omitted.",
  };
}

function buildVectorRecord(input: {
  knowledgeBaseId: UUID;
  document: PreparedDocument;
  chunk: KnowledgeChunk;
  vector: readonly number[];
  provider: string;
  model: string;
  modelVersion: string;
  embeddedAt: string;
  dimension: number;
}) {
  const chunkId = stableUuid(`${input.document.manifest.document_id}:${input.chunk.chunkIndex}:${input.chunk.textHash}`);
  const evidenceMetadata = jsonValue({
    ...input.chunk.metadata,
    qaEligibility: { status: "eligible", reviewWarnings: [] },
    evidence: {
      sourceDocumentId: input.document.sourceId,
      sourceDocumentName: input.document.manifest.file_name,
      sectionPath: input.chunk.sectionPath,
      sourceSegments: input.chunk.sourceSegments.map((segment) => ({
        sourceBlockId: segment.sourceBlockId,
        kind: segment.kind,
        normalizedText: segment.normalizedText,
        sourceBlockText: segment.sourceBlockText,
        normalizedStartChar: segment.normalizedStartChar,
        normalizedEndChar: segment.normalizedEndChar,
        locator: segment.locator,
        metadata: segment.metadata,
      })),
    },
  }) as JsonObject;
  const chunkRecord = {
    rank: 1,
    chunkId,
    documentId: input.document.sourceId,
    documentName: input.document.manifest.file_name,
    documentVersion: 1,
    documentMimeType: input.document.manifest.mime_type,
    chunkIndex: input.chunk.chunkIndex,
    text: input.chunk.text,
    tokenCount: input.chunk.tokenCount,
    similarityScore: 0,
    distance: 1,
    metadata: evidenceMetadata,
    documentMetadata: jsonObject(input.document.parsed.metadata),
    locator: retrievalLocator(input.chunk),
    embedding: {
      provider: input.provider,
      model: input.model,
      modelVersion: input.modelVersion,
      dimension: input.dimension,
      embeddedAt: input.embeddedAt,
    },
  };
  return {
    knowledgeBaseId: input.knowledgeBaseId,
    chunk: chunkRecord,
    vector: input.vector,
    source: {
      chunkId,
      documentId: input.document.sourceId,
      documentName: input.document.manifest.file_name,
      documentVersion: 1,
      documentStatus: "ready" as const,
      chunkText: input.chunk.text,
      locator: jsonObject(jsonValue(chunkRecord.locator)),
    },
  };
}

async function runActual(input: {
  prepared: Awaited<ReturnType<typeof prepareCorpus>>;
  mode: "smoke" | "full" | "full-v2" | "full-v3";
  budget: { approvedUsd: number; approvedCny: number };
  preflight: JsonObject;
  acceptanceV2?: AcceptanceV2;
  acceptanceV2Hash?: string;
  acceptanceV3?: AcceptanceV3;
  acceptanceV3Hash?: string;
  onStageChange?: (stage: string) => void;
}): Promise<JsonObject> {
  const sourceFingerprint = input.mode === "full-v2"
    ? await evaluationSourceFingerprint()
    : input.mode === "full-v3"
      ? await evaluationSourceFingerprintV3()
      : null;
  input.onStageChange?.("model_client_setup");
  const embeddingConfig = getEmbeddingConfig();
  const languageConfig = getLanguageModelConfig({
    ...process.env,
    LANGUAGE_MODEL_MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS),
  });
  requireApprovedModelDestination({
    provider: embeddingConfig.provider,
    model: embeddingConfig.model,
    baseURL: embeddingConfig.baseURL,
    expectedProvider: "dashscope",
    expectedModel: "text-embedding-v2",
    expectedHost: "dashscope.aliyuncs.com",
  });
  requireApprovedModelDestination({
    provider: languageConfig.provider,
    model: languageConfig.model,
    baseURL: languageConfig.baseURL,
    expectedProvider: "deepseek",
    expectedModel: "deepseek-flash",
    expectedHost: "api.deepseek.com",
  });
  const embeddingClient = new OpenAI({ apiKey: embeddingConfig.apiKey, baseURL: embeddingConfig.baseURL, maxRetries: 0, timeout: 60_000 });
  const embeddingProvider: EmbeddingProvider = new OpenAIEmbeddingProvider(embeddingConfig, { client: embeddingClient });
  const languageClient = new OpenAI({ apiKey: languageConfig.apiKey, baseURL: languageConfig.baseURL, maxRetries: 0, timeout: 60_000 });
  const languageProvider = languageConfig.provider.toLowerCase() === "deepseek"
    ? new DeepSeekLanguageModelProvider(languageConfig, { client: languageClient })
    : new OpenAILanguageModelProvider(languageConfig, { client: languageClient });
  const index = new LocalVectorIndex();
  const chunks = input.prepared.documents.flatMap((document) => document.eligibleChunks.map((chunk) => ({ document, chunk })));
  if (chunks.length === 0) throw new Error("No review-cleared chunks are available for embedding.");
  input.onStageChange?.("document_embedding_request");
  const documentEmbedding = await embeddingProvider.embed(chunks.map(({ chunk }) => chunk.text));
  if (documentEmbedding.vectors.length !== chunks.length || documentEmbedding.dimensions !== embeddingProvider.dimensions) {
    throw new Error("Embedding response did not match the local vector contract.");
  }
  for (const [indexPosition, item] of chunks.entries()) {
    const vector = documentEmbedding.vectors[indexPosition];
    if (!vector) throw new Error(`Missing document embedding at position ${indexPosition}.`);
    index.add(buildVectorRecord({
      knowledgeBaseId: DEFAULT_KNOWLEDGE_BASE_ID,
      document: item.document,
      chunk: item.chunk,
      vector,
      provider: documentEmbedding.provider,
      model: documentEmbedding.model,
      modelVersion: documentEmbedding.modelVersion,
      embeddedAt: documentEmbedding.embeddedAt,
      dimension: documentEmbedding.dimensions,
    }));
  }

  const config = getRetrieverConfig();
  const retrievalEngine = new RetrievalEngine(
    new RetrieverService(index, embeddingProvider, config),
    undefined,
    new ContextBuilder({
      minimumSimilarity: config.defaultSimilarityThreshold,
      maxTokens: DEEPSEEK_CONTEXT_TOKENS,
    }),
  );
  const answerGenerator = new AnswerGenerator(languageProvider);
  const verifier = new EvidenceVerificationLayer(index);
  const acceptancePolicies = input.mode === "full-v3"
    ? input.acceptanceV3?.cases
    : input.acceptanceV2?.cases;
  const policiesById = new Map(acceptancePolicies?.map((item) => [item.case_id, item]));
  const caseResults: Array<JsonObject> = [];
  let generationRequests = 0;
  let queryEmbeddingRequestsAttempted = 0;
  let queryEmbeddingVectorsRequested = 0;
  let generationRequestsAttempted = 0;
  let queryEmbeddingTokens = 0;
  let generationInputTokens = 0;
  let generationOutputTokens = 0;

  for (const item of input.prepared.runtimeCases) {
    const started = Date.now();
    const policy = policiesById.get(item.case_id);
    const blockedSourceScope = policy?.blocked_source
      ? [stableUuid(policy.blocked_source.document_id)]
      : undefined;
    let caseStage = "query_embedding_and_vector_retrieval";
    let retrievalAudit: JsonObject | null = null;
    try {
      input.onStageChange?.(`${item.case_id}:query_embedding_request`);
      queryEmbeddingRequestsAttempted += 1;
      const retrieval = await retrievalEngine.execute({
        query: item.question,
        knowledgeBaseId: DEFAULT_KNOWLEDGE_BASE_ID,
        requestedTaskType: "auto",
        ...(blockedSourceScope ? { documentIds: blockedSourceScope } : {}),
      });
      queryEmbeddingTokens += retrieval.retrieval.embedding.usageTokens ?? 0;
      const embeddingVariants = retrieval.retrieval.embedding.embeddingVariants ?? 1;
      queryEmbeddingVectorsRequested += embeddingVariants;
      retrievalAudit = {
        executed: true,
        storage: "process-local in-memory vector index",
        algorithm: "cosine similarity over returned provider vectors",
        query_embedding: {
          provider: retrieval.retrieval.embedding.provider,
          model: retrieval.retrieval.embedding.model,
          dimensions: retrieval.retrieval.embedding.dimensions,
          usage_tokens: retrieval.retrieval.embedding.usageTokens,
          query_expansion_terms: retrieval.retrieval.embedding.queryExpansionTerms ?? [],
          query_embedding_vectors: embeddingVariants,
        },
        chunks: retrieval.retrieval.chunks.map((chunk) => ({
          chunk_id: chunk.chunkId,
          document_id: input.prepared.documents.find((document) => document.sourceId === chunk.documentId)?.manifest.document_id ?? null,
          source_file: chunk.documentName,
          rank: chunk.rank,
          similarity: chunk.similarityScore,
          text: chunk.text,
          locator: jsonValue(chunk.locator),
          ocr_provenance: retrievalOcrProvenance(chunk),
        })),
        context_chunks: retrieval.context.chunks.map((chunk) => ({
          chunk_id: chunk.chunkId,
          document_id: input.prepared.documents.find((document) => document.sourceId === chunk.documentId)?.manifest.document_id ?? null,
          source_file: chunk.documentName,
          citation_label: chunk.citationLabel,
          similarity: chunk.similarityScore,
          text: chunk.text,
          locator: jsonValue(chunk.locator),
          ocr_provenance: retrievalOcrProvenance(chunk),
        })),
        scoped_document_ids: policy?.blocked_source?.document_id
          ? [policy.blocked_source.document_id]
          : null,
        context_stats: jsonValue(retrieval.context.stats),
      };
      caseStage = "answer_generation_without_context";
      if (retrieval.context.chunks.length > 0) {
        caseStage = "answer_generation";
        input.onStageChange?.(`${item.case_id}:generation_request`);
        generationRequestsAttempted += 1;
      }
      const generated = await answerGenerator.generate({
        query: retrieval.query,
        taskUnderstanding: retrieval.taskUnderstanding,
        context: retrieval.context,
        visualEvidenceRequired: Boolean(policy?.blocked_source) || policy?.standard === "verified_ocr_answer",
      });
      const verification = await verifier.verify(generated.structuredAnswer, retrieval);
      if (generated.model) generationRequests += 1;
      generationInputTokens += generated.inputTokens ?? 0;
      generationOutputTokens += generated.outputTokens ?? 0;
      caseResults.push({
        case_id: item.case_id,
        query: item.question,
        retrieval: retrievalAudit,
        generation: {
          executed: generated.model !== null,
          provider: languageProvider.provider,
          model: generated.model,
          input_tokens: generated.inputTokens,
          output_tokens: generated.outputTokens,
          answer: jsonValue(generated.structuredAnswer),
        },
        evidence: {
          valid_count: verification.validEvidenceCount,
          invalid_count: verification.invalidEvidenceCount,
          unsupported_claim_count: verification.unsupportedClaimCount,
          verification_rules: jsonValue(verification.details.verification_rules ?? []),
          claims: jsonValue(verification.claims),
        },
        latency_ms: Math.max(0, Date.now() - started),
        status: "EXECUTED",
      });
    } catch (error) {
      caseResults.push({
        case_id: item.case_id,
        query: item.question,
        status: "FAILED",
        failed_stage: caseStage,
        retrieval: retrievalAudit,
        latency_ms: Math.max(0, Date.now() - started),
        error: safeError(error),
      });
    }
  }

  input.onStageChange?.("ground_truth_evaluation");
  const manifestAfterRun = await readManifest();
  const casesById = new Map(manifestAfterRun.cases.map((item) => [item.case_id, item]));
  const evaluatedCases: JsonObject[] = caseResults.map((result) => {
    const caseId = String(result.case_id);
    const expected = casesById.get(caseId);
    if (!expected || result.status !== "EXECUTED") return jsonValue({ ...result, evaluation: { status: "UNVERIFIED" } }) as JsonObject;
    const policy = policiesById.get(caseId);
    const evaluation = input.mode === "full-v2"
      ? policy
        ? evaluateCaseResultV2(result, expected as V2Expectation, policy)
        : { status: "UNVERIFIED", reason: "Acceptance v2 mapping is missing for this case." }
      : input.mode === "full-v3"
        ? policy
          ? evaluateCaseResultV3(result, expected as V2Expectation, policy)
          : { status: "UNVERIFIED", reason: "Acceptance v3 mapping is missing for this case." }
        : evaluateCaseResult(result, expected as EvaluationExpectation);
    return jsonValue({
      ...result,
      evaluation,
    }) as JsonObject;
  });
  const passed = evaluatedCases.filter((result) => jsonObject(result.evaluation).status === "PASS").length;
  const requestedCases = input.prepared.runtimeCases.length;
  const v2DocumentProfiles = new Map(input.acceptanceV2?.documents.map((item) => [item.document_id, item.v2_profile]));
  const v3DocumentProfiles = new Map(input.acceptanceV3?.documents.map((item) => [item.document_id, item.v3_profile]));
  const documentResults = input.prepared.documents.map((document) => {
    const profile = input.mode === "full-v3"
      ? v3DocumentProfiles.get(document.manifest.document_id)
      : v2DocumentProfiles.get(document.manifest.document_id);
    const v2Acceptance = input.mode === "full-v2" && profile
      ? documentAcceptanceStatus(document, profile)
      : null;
    const v3Acceptance = input.mode === "full-v3" && profile
      ? documentAcceptanceStatusV3(document, profile)
      : null;
    return ({
    document_id: document.manifest.document_id,
    file_name: document.manifest.file_name,
    file_format: document.manifest.file_format,
    sha256: document.manifest.document_hash,
    parser: document.parsed.parser,
    parse_status: document.parserStatus,
    acceptance_profile: profile ?? null,
    acceptance_v2_profile: input.mode === "full-v2" ? profile ?? null : null,
    acceptance_v2_status: v2Acceptance?.status ?? null,
    acceptance_v2_reason: v2Acceptance?.reason ?? null,
    acceptance_v3_profile: input.mode === "full-v3" ? profile ?? null : null,
    acceptance_v3_status: v3Acceptance?.status ?? null,
    acceptance_v3_reason: v3Acceptance?.reason ?? null,
    extracted_text: document.parsed.blocks.map((block) => ({
      block_id: block.id,
      kind: block.kind,
      text: block.text,
      locator: jsonValue(block.locator),
      metadata: jsonValue(block.metadata),
    })),
    warnings: document.warnings,
    review_required: document.reviewRequired,
    chunks: document.chunks.map((chunk) => ({
      chunk_id: stableUuid(`${document.manifest.document_id}:${chunk.chunkIndex}:${chunk.textHash}`),
      chunk_index: chunk.chunkIndex,
      text: chunk.text,
      text_sha256: chunk.textHash,
      token_count_estimate: chunk.tokenCount,
      locator: retrievalLocator(chunk),
      embedded: !document.excludedChunkIndexes.includes(chunk.chunkIndex),
      stored_in: document.excludedChunkIndexes.includes(chunk.chunkIndex)
        ? null
        : "process-local in-memory vector index",
      retrieval_eligible: !document.excludedChunkIndexes.includes(chunk.chunkIndex),
      exclusion_reason: document.excludedChunkIndexes.includes(chunk.chunkIndex) ? "source_has_review_required_extraction_warning" : null,
    })),
    embedding: {
      executed: document.eligibleChunks.length > 0,
      provider: documentEmbedding.provider,
      model: documentEmbedding.model,
      dimensions: documentEmbedding.dimensions,
      chunk_count: document.eligibleChunks.length,
    },
  });
  });

  const documentAcceptancePassed = input.mode === "full-v2"
    ? documentResults.every((document) => document.acceptance_v2_status === "PASS")
    : input.mode === "full-v3"
      ? documentResults.every((document) => document.acceptance_v3_status === "PASS")
      : true;

  return {
    schema_version: input.mode === "full-v3" ? "3.0.0" : input.mode === "full-v2" ? "2.0.0" : "1.0.0",
    mode: input.mode,
    acceptance_version: input.mode === "full-v3"
      ? input.acceptanceV3?.schema_version ?? null
      : input.mode === "full-v2" ? input.acceptanceV2?.schema_version ?? null : "1.0.0",
    acceptance_v2_sha256: input.mode === "full-v2" ? input.acceptanceV2Hash ?? null : null,
    acceptance_v3_sha256: input.mode === "full-v3" ? input.acceptanceV3Hash ?? null : null,
    evaluation_source_fingerprint: sourceFingerprint,
    generated_at: new Date().toISOString(),
    execution_boundary: "Model endpoints were called; embeddings and answers were stored only in process memory and this local report. No Supabase or business database was called.",
    local_vector_records: index.size,
    documents: documentResults,
    providers: {
      embedding: { provider: documentEmbedding.provider, model: documentEmbedding.model, dimensions: documentEmbedding.dimensions },
      generation: { provider: languageProvider.provider, model: languageProvider.model },
    },
    requests: {
      document_embedding_requests_upper_bound: Math.ceil(chunks.length / effectiveEmbeddingBatchSize()),
      query_embedding_requests_upper_bound: requestedCases,
      query_embedding_requests_attempted: queryEmbeddingRequestsAttempted,
      query_embedding_vectors_requested: queryEmbeddingVectorsRequested,
      generation_requests_actual: generationRequests,
      generation_requests_attempted: generationRequestsAttempted,
      retry_policy: "OpenAI SDK maxRetries=0; timeout=60 seconds",
      document_embedding_tokens_reported: documentEmbedding.usageTokens,
      query_embedding_tokens_reported: queryEmbeddingTokens,
      generation_input_tokens_reported: generationInputTokens,
      generation_output_tokens_reported: generationOutputTokens,
    },
    estimated_cost_from_reported_usage: estimateReportedUsageCost({
      documentEmbeddingTokens: documentEmbedding.usageTokens ?? 0,
      queryEmbeddingTokens,
      generationInputTokens,
      generationOutputTokens,
    }),
    approved_cost_caps: input.budget,
    preflight: input.preflight,
    aggregate: {
      total_cases: requestedCases,
      passed,
      failed: evaluatedCases.filter((result) =>
        result.status === "FAILED" || jsonObject(result.evaluation).status === "FAIL",
      ).length,
      not_verified: evaluatedCases.filter((result) => jsonObject(result.evaluation).status === "UNVERIFIED").length,
      document_acceptance: input.mode === "full-v2" ? {
        total: documentResults.length,
        passed: documentResults.filter((document) => document.acceptance_v2_status === "PASS").length,
        failed: documentResults.filter((document) => document.acceptance_v2_status !== "PASS").length,
      } : input.mode === "full-v3" ? {
        total: documentResults.length,
        passed: documentResults.filter((document) => document.acceptance_v3_status === "PASS").length,
        failed: documentResults.filter((document) => document.acceptance_v3_status !== "PASS").length,
      } : null,
      status: passed === requestedCases && documentAcceptancePassed ? "PASS" : "PARTIAL",
    },
    cases: evaluatedCases,
  };
}

async function runGenerationSmokeFromExistingRetrieval(
  budget: { approvedUsd: number; approvedCny: number },
): Promise<JsonObject> {
  const requestedSourceFile = process.env.NOVERA_DOCUMENT_RAG_SOURCE_RUN ?? GENERATION_SMOKE_SOURCE_RUN;
  if (path.basename(requestedSourceFile) !== requestedSourceFile) {
    throw new Error("The generation replay source must be a run artifact filename.");
  }
  const sourceRunPath = path.join(RUNS, requestedSourceFile);
  const requestedCaseId = process.env.NOVERA_DOCUMENT_RAG_CASE_ID ?? "case-025";
  const sourceRun = jsonObject(JSON.parse(await readFile(sourceRunPath, "utf8")) as unknown);
  const manifest = await readManifest();
  const sourceCases = Array.isArray(sourceRun.cases) ? sourceRun.cases.map(jsonObject) : [];
  const sourceCase = sourceCases.find((item) => item.case_id === requestedCaseId);
  const manifestCase = manifest.cases.find((item) => item.case_id === requestedCaseId);
  const sourceDocuments = Array.isArray(sourceRun.documents) ? sourceRun.documents.map(jsonObject) : [];
  const manifestDocuments = new Map(manifest.documents.map((item) => [item.document_id, item]));
  const sourceDocumentsById = new Map(sourceDocuments.map((item) => [item.document_id, item]));

  if (!sourceCase || !manifestCase || sourceCase.query !== manifestCase.question) {
    throw new Error("The saved retrieval artifact does not match the fixed case identity.");
  }

  const retrieval = jsonObject(sourceCase.retrieval);
  const retrievedChunks = Array.isArray(retrieval.chunks) ? retrieval.chunks.map(jsonObject) : [];
  const candidates: ContextSourceChunk[] = [];

  for (const retrieved of retrievedChunks) {
    if (typeof retrieved.chunk_id !== "string" || typeof retrieved.document_id !== "string" ||
        typeof retrieved.source_file !== "string" || typeof retrieved.text !== "string" ||
        typeof retrieved.similarity !== "number") continue;
    const manifestDocument = manifestDocuments.get(String(retrieved.document_id));
    const sourceDocument = sourceDocumentsById.get(String(retrieved.document_id));
    if (!manifestDocument || !sourceDocument || sourceDocument.sha256 !== manifestDocument.document_hash) continue;
    const documentChunks = Array.isArray(sourceDocument.chunks) ? sourceDocument.chunks.map(jsonObject) : [];
    const sourceChunk = documentChunks.find((item) => item.chunk_id === retrieved.chunk_id);
    if (!sourceChunk || sourceChunk.retrieval_eligible !== true || typeof sourceChunk.chunk_index !== "number") continue;
    candidates.push({
      chunkId: retrieved.chunk_id as UUID,
      documentId: stableUuid(retrieved.document_id),
      documentName: retrieved.source_file,
      chunkIndex: sourceChunk.chunk_index,
      text: retrieved.text,
      similarityScore: retrieved.similarity,
      metadata: {},
      locator: jsonObject(retrieved.locator),
      tokenCount: typeof sourceChunk.token_count_estimate === "number" ? sourceChunk.token_count_estimate : null,
    });
  }

  const retrieverConfig = getRetrieverConfig();
  const context = new ContextBuilder({
    minimumSimilarity: retrieverConfig.defaultSimilarityThreshold,
    maxTokens: DEEPSEEK_CONTEXT_TOKENS,
  }).build(candidates);
  if (context.chunks.length === 0) {
    throw new Error("The saved retrieval result contains no eligible context for generation.");
  }

  const queryUnderstanding = new QueryUnderstandingLayer().understand({
    query: manifestCase.question,
    requestedTaskType: "auto",
  });
  const languageConfig = getLanguageModelConfig({
    ...process.env,
    LANGUAGE_MODEL_MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS),
  });
  requireApprovedModelDestination({
    provider: languageConfig.provider,
    model: languageConfig.model,
    baseURL: languageConfig.baseURL,
    expectedProvider: "deepseek",
    expectedModel: "deepseek-flash",
    expectedHost: "api.deepseek.com",
  });

  let requestCount = 0;
  let httpStatus: number | null = null;
  const fetchOnce: typeof fetch = async (input, init) => {
    if (requestCount >= 1) throw new Error("The generation smoke request limit has been reached.");
    requestCount += 1;
    const response = await fetch(input, init);
    httpStatus = response.status;
    return response;
  };
  const client = new OpenAI({
    apiKey: languageConfig.apiKey,
    baseURL: languageConfig.baseURL,
    maxRetries: 0,
    timeout: 60_000,
    fetch: fetchOnce,
  });
  const provider = new DeepSeekLanguageModelProvider(languageConfig, { client: client as never });
  const startedAt = new Date().toISOString();

  try {
    const generated = await new AnswerGenerator(provider).generate({
      query: manifestCase.question,
      taskUnderstanding: queryUnderstanding,
      context,
    });
    const answer = generated.structuredAnswer.answer;
    const nonEmpty = typeof answer === "string" && answer.trim().length > 0;
    return {
      schema_version: "1.0.0",
      mode: "generation-replay",
      generated_at: new Date().toISOString(),
      source_run_artifact: path.relative(process.cwd(), sourceRunPath),
      execution_boundary: "Reused the previously recorded retrieval result. This run made no Embedding, retrieval, Supabase, database, or Storage calls.",
      provider: languageConfig.provider,
      model: languageConfig.model,
      endpoint_host: "api.deepseek.com",
      case_id: manifestCase.case_id,
      query: manifestCase.question,
      retrieval: jsonValue(retrieval),
      generation: {
        attempted: requestCount === 1,
        http_status: httpStatus,
        succeeded: httpStatus !== null && httpStatus >= 200 && httpStatus < 300 && nonEmpty,
        non_empty: nonEmpty,
        answer: jsonValue(generated.structuredAnswer),
        input_tokens: generated.inputTokens,
        output_tokens: generated.outputTokens,
        prompt_version: generated.promptVersion,
      },
      requests: {
        document_embedding: 0,
        query_embedding: 0,
        vector_retrieval: 0,
        generation_attempted: requestCount,
        max_retries: 0,
      },
      approved_cost_caps: budget,
      status: httpStatus !== null && httpStatus >= 200 && httpStatus < 300 && nonEmpty ? "PASS" : "BLOCKED",
      started_at: startedAt,
      source_case_status: sourceCase.status,
    };
  } catch (error) {
    return {
      schema_version: "1.0.0",
      mode: "generation-replay",
      generated_at: new Date().toISOString(),
      source_run_artifact: path.relative(process.cwd(), sourceRunPath),
      execution_boundary: "Reused the previously recorded retrieval result. This run made no Embedding, retrieval, Supabase, database, or Storage calls.",
      provider: languageConfig.provider,
      model: languageConfig.model,
      endpoint_host: "api.deepseek.com",
      case_id: manifestCase.case_id,
      query: manifestCase.question,
      retrieval: jsonValue(retrieval),
      generation: {
        attempted: requestCount === 1,
        http_status: httpStatus,
        succeeded: false,
        non_empty: false,
        error: safeError(error),
      },
      requests: {
        document_embedding: 0,
        query_embedding: 0,
        vector_retrieval: 0,
        generation_attempted: requestCount,
        max_retries: 0,
      },
      approved_cost_caps: budget,
      status: "BLOCKED",
      started_at: startedAt,
      source_case_status: sourceCase.status,
    };
  }
}

async function rescoreV3Artifact(sourceFileName: string): Promise<{ artifactPath: string; result: JsonObject }> {
  if (path.basename(sourceFileName) !== sourceFileName) {
    throw new Error("The v3 rescore source must be a run artifact filename.");
  }
  const sourcePath = path.join(RUNS, sourceFileName);
  const source = JSON.parse(await readFile(sourcePath, "utf8")) as JsonObject;
  if (source.mode !== "full-v3") throw new Error("The rescore source must be a full-v3 artifact.");

  const acceptanceResult = await readAcceptanceV3();
  const prepared = await prepareCorpus();
  const manifest = await readManifest();
  const expectations = new Map(manifest.cases.map((item) => [item.case_id, item]));
  const policies = new Map(acceptanceResult.acceptance.cases.map((item) => [item.case_id, item]));
  const sourceCases = Array.isArray(source.cases) ? source.cases.map(jsonObject) : [];
  const cases = sourceCases.map((result) => {
    const expected = expectations.get(String(result.case_id));
    const policy = policies.get(String(result.case_id));
    if (!expected || !policy || result.status !== "EXECUTED") {
      return jsonValue({ ...result, evaluation: { status: "UNVERIFIED", reason: "Missing executable v3 source result." } }) as JsonObject;
    }
    return jsonValue({
      ...result,
      evaluation: evaluateCaseResultV3(result, expected as V2Expectation, policy),
    }) as JsonObject;
  });
  const profiles = new Map(acceptanceResult.acceptance.documents.map((item) => [item.document_id, item.v3_profile]));
  const sourceDocuments = Array.isArray(source.documents) ? source.documents.map(jsonObject) : [];
  const documents = prepared.documents.map((document) => {
    const previous = sourceDocuments.find((item) => item.document_id === document.manifest.document_id) ?? {};
    const profile = profiles.get(document.manifest.document_id) ?? "";
    const acceptance = documentAcceptanceStatusV3(document, profile);
    return jsonValue({ ...previous, acceptance_v3_profile: profile, acceptance_v3_status: acceptance.status, acceptance_v3_reason: acceptance.reason }) as JsonObject;
  });
  const passed = cases.filter((item) => jsonObject(item.evaluation).status === "PASS").length;
  const result: JsonObject = {
    ...source,
    schema_version: "3.0.0",
    mode: "rescore-v3",
    acceptance_version: acceptanceResult.acceptance.schema_version,
    acceptance_v3_sha256: acceptanceResult.sha256,
    source_run_artifact: path.relative(process.cwd(), sourcePath),
    source_execution_fingerprint: source.evaluation_source_fingerprint ?? null,
    evaluation_source_fingerprint: await evaluationSourceFingerprintV3(),
    generated_at: new Date().toISOString(),
    execution_boundary: "Re-scored a completed full-v3 artifact offline. No Embedding, generation, Supabase, database, or Storage calls were made.",
    documents,
    aggregate: {
      total_cases: cases.length,
      passed,
      failed: cases.filter((item) => jsonObject(item.evaluation).status === "FAIL").length,
      not_verified: cases.filter((item) => jsonObject(item.evaluation).status === "UNVERIFIED").length,
      document_acceptance: {
        total: documents.length,
        passed: documents.filter((item) => item.acceptance_v3_status === "PASS").length,
        failed: documents.filter((item) => item.acceptance_v3_status !== "PASS").length,
      },
      status: passed === cases.length && documents.every((item) => item.acceptance_v3_status === "PASS") ? "PASS" : "PARTIAL",
    },
    cases,
  };
  const artifactPath = await saveArtifact("rescore-v3", result);
  return { artifactPath, result };
}

export async function runDocumentReliabilityMode(mode: "prepare" | "prepare-v2" | "prepare-v3" | "smoke" | "full" | "full-v2" | "full-v3" | "rescore-v3" | "generation-smoke" | "generation-replay"): Promise<{ artifactPath: string; result: JsonObject }> {
  await loadSafeLocalModelConfig();
  if (mode === "rescore-v3") {
    return rescoreV3Artifact(process.env.NOVERA_DOCUMENT_RAG_SOURCE_RUN ?? "");
  }
  if (mode === "generation-smoke" || mode === "generation-replay") {
    const budget = requireApprovedBudget({
      deepseek_estimated_peak_upper_bound_usd: 0.001814,
      dashscope_estimated_upper_bound_cny: 0,
    });
    await loadRuntimeEnvironmentAfterApproval();
    let result: JsonObject;
    try {
      result = await runGenerationSmokeFromExistingRetrieval(budget);
    } catch (error) {
      result = {
        schema_version: "1.0.0",
        mode: "generation-smoke-replay",
        generated_at: new Date().toISOString(),
        execution_boundary: "No Embedding, retrieval, Supabase, database, or Storage calls were made.",
        generation: { attempted: false, http_status: null, succeeded: false, non_empty: false, error: safeError(error) },
        requests: { document_embedding: 0, query_embedding: 0, vector_retrieval: 0, generation_attempted: 0, max_retries: 0 },
        approved_cost_caps: budget,
        status: "BLOCKED",
      };
    }
    const artifactPath = await saveArtifact(mode, result);
    return { artifactPath, result };
  }

  const acceptanceV2Result = mode.endsWith("-v2") ? await readAcceptanceV2() : null;
  const acceptanceV3Result = mode.endsWith("-v3") ? await readAcceptanceV3() : null;
  const smokeDocument = new Set(["doc-013"]);
  const prepared = await prepareCorpus(mode === "smoke" ? smokeDocument : undefined);
  const costPlan = buildPreflight(prepared, mode, acceptanceV3Result?.sha256 ?? acceptanceV2Result?.sha256);
  if (mode === "prepare" || mode === "prepare-v2" || mode === "prepare-v3") {
    const artifactPath = await saveArtifact(mode, costPlan);
    return { artifactPath, result: costPlan };
  }

  const estimate = jsonObject(costPlan.cost_estimate);
  if (mode === "smoke" && process.env.NOVERA_DOCUMENT_RAG_COST_APPROVED !== "YES") {
    const artifactPath = await saveArtifact("smoke-preflight", costPlan);
    return { artifactPath, result: costPlan };
  }
  const budget = requireApprovedBudget(estimate);
  let stage = "runtime_environment_load";
  let modelRequestMayHaveStarted = false;
  let result: JsonObject;
  try {
    await loadRuntimeEnvironmentAfterApproval();
    result = await runActual({
      prepared,
      mode,
      budget,
      preflight: costPlan,
      ...(acceptanceV2Result ? {
        acceptanceV2: acceptanceV2Result.acceptance,
        acceptanceV2Hash: acceptanceV2Result.sha256,
      } : {}),
      ...(acceptanceV3Result ? {
        acceptanceV3: acceptanceV3Result.acceptance,
        acceptanceV3Hash: acceptanceV3Result.sha256,
      } : {}),
      onStageChange: (nextStage) => {
        stage = nextStage;
        if (nextStage.endsWith("_request")) modelRequestMayHaveStarted = true;
      },
    });
  } catch (error) {
    result = {
      schema_version: "1.0.0",
      mode,
      generated_at: new Date().toISOString(),
      execution_boundary: "The local isolation and cost gate passed. No database or Storage was called. A model request may have started only if the recorded stage is a request stage.",
      real_model_calls_may_have_started: modelRequestMayHaveStarted,
      failed_stage: stage,
      providers: jsonObject(costPlan.configured_model_identity),
      approved_cost_caps: budget,
      preflight: costPlan,
      aggregate: { total_cases: prepared.runtimeCases.length, passed: 0, failed: 0, not_run: prepared.runtimeCases.length, status: "PARTIAL" },
      error: safeError(error),
    };
  }
  const artifactPath = await saveArtifact(mode, result);
  return { artifactPath, result };
}
