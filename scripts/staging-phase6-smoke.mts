import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ENV_PATH = resolve(process.cwd(), ".env.local");
const DEFAULT_KNOWLEDGE_BASE_ID = "00000000-0000-4000-8000-000000000001";
const EMBEDDING_DIMENSION = 1536;
const FIXTURE_MIME_TYPE = "text/markdown";
const DEFAULT_PIPELINE_TIMEOUT_MS = 240_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 150_000;
const execFileAsync = promisify(execFile);

type JsonRecord = Record<string, unknown>;

interface SmokeResources {
  documentId: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  qaRunId: string | null;
  conversationId: string | null;
}

interface ReadyResult {
  document: JsonRecord;
  job: JsonRecord;
  observedDocumentStatuses: string[];
  observedJobStatuses: string[];
}

interface VerifiedChunk {
  id: string;
  text: string;
  embeddingModel: string;
}

interface MetricResult {
  score: number;
  explanation: string;
}

async function loadDotEnv(path: string): Promise<void> {
  if (!existsSync(path)) return;

  const source = await readFile(path, "utf8");

  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;

    const name = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (process.env[name] !== undefined) continue;
    process.env[name] = rawValue.replace(/^(['"])(.*)\1$/u, "$2");
  }
}

function environment(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value !== "[SENSITIVE]" ? value : null;
}

function boundedIntegerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment(name);

  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }

  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredRecord(parent: JsonRecord, key: string, label: string): JsonRecord {
  const value = parent[key];

  if (!isRecord(value)) {
    throw new Error(`${label} did not return a valid ${key} object.`);
  }

  return value;
}

function requiredString(parent: JsonRecord, key: string, label: string): string {
  const value = parent[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} did not return a valid ${key}.`);
  }

  return value;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function apiUrl(baseUrl: string, pathname: string): URL {
  const url = new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("QA_SMOKE_URL must use http or https.");
  }

  return url;
}

function sanitizedPayload(value: unknown): string {
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(value, (key, child) => {
    if (/token|secret|api[_-]?key|signed[_-]?url/i.test(key)) return "[redacted]";

    if (child && typeof child === "object") {
      if (seen.has(child)) return "[circular]";
      seen.add(child);
    }

    return child;
  });

  return (serialized ?? String(value)).slice(0, 1_500);
}

function shouldUseVercelCurl(): boolean {
  const value = environment("QA_SMOKE_USE_VERCEL_CURL");
  return value === "1" || value?.toLowerCase() === "true";
}

function responsePayload(text: string, label: string): JsonRecord {
  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  const candidate = firstObject >= 0 && lastObject >= firstObject
    ? text.slice(firstObject, lastObject + 1)
    : text.trim();

  let payload: unknown = null;
  try {
    payload = JSON.parse(candidate);
  } catch {
    payload = candidate;
  }

  if (!isRecord(payload)) {
    throw new Error(`${label} did not return a JSON object.`);
  }

  return payload;
}

async function requestViaVercelCurl(
  label: string,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<JsonRecord> {
  const deployment = url.origin;
  const args = [
    "curl",
    "--json",
    url.pathname + url.search,
    "--deployment",
    deployment,
    "--",
    "--silent",
    "--show-error",
    "--fail-with-body",
  ];
  const method = init.method?.toUpperCase() ?? "GET";
  if (method !== "GET") args.push("--request", method);

  const headers = init.headers instanceof Headers
    ? [...init.headers.entries()]
    : Object.entries(init.headers ?? {});
  for (const [name, value] of headers) {
    args.push("--header", `${name}: ${String(value)}`);
  }
  if (typeof init.body === "string") args.push("--data", init.body);

  const vercelBin = environment("QA_SMOKE_VERCEL_BIN") ?? "vercel";
  try {
    const result = await execFileAsync(vercelBin, args, {
      env: process.env,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return responsePayload(result.stdout, label);
  } catch (error) {
    const details = isRecord(error) && typeof error.stdout === "string"
      ? error.stdout
      : error instanceof Error
        ? error.message
        : "unknown error";
    throw new Error(`${label} request failed via vercel curl: ${sanitizedPayload(details)}`, {
      cause: error,
    });
  }
}

async function requestJson(
  label: string,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<JsonRecord> {
  if (shouldUseVercelCurl()) {
    return requestViaVercelCurl(label, url, init, timeoutMs);
  }

  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(
      `${label} request failed: ${error instanceof Error ? error.message : "unknown error"}`,
      { cause: error },
    );
  }

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new Error(
      `${label} failed with HTTP ${response.status}: ${sanitizedPayload(payload)}`,
    );
  }

  if (!isRecord(payload)) {
    throw new Error(`${label} did not return a JSON object.`);
  }

  return payload;
}

function addObservedStatus(target: string[], value: unknown): void {
  if (typeof value === "string" && !target.includes(value)) target.push(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function failureDetails(document: JsonRecord, job: JsonRecord | null): string {
  return sanitizedPayload({
    document_status: document.status,
    document_error_code: document.error_code,
    document_error_message: document.error_message,
    job_status: job?.status ?? null,
    job_error_code: job?.error_code ?? null,
    job_error_message: job?.error_message ?? null,
  });
}

async function pollUntilReady(input: {
  baseUrl: string;
  documentId: string;
  processingJobId: string;
  pipelineTimeoutMs: number;
  requestTimeoutMs: number;
  initialDocumentStatuses: string[];
  initialJobStatuses: string[];
}): Promise<ReadyResult> {
  const observedDocumentStatuses = [...input.initialDocumentStatuses];
  const observedJobStatuses = [...input.initialJobStatuses];
  const deadline = Date.now() + input.pipelineTimeoutMs;
  let pollingDelayMs = 750;
  let lastDocument: JsonRecord | null = null;
  let lastJob: JsonRecord | null = null;

  while (Date.now() <= deadline) {
    const payload = await requestJson(
      "Document status",
      apiUrl(input.baseUrl, `/api/v1/documents/${encodeURIComponent(input.documentId)}`),
      { method: "GET" },
      Math.min(input.requestTimeoutMs, 30_000),
    );
    const document = requiredRecord(payload, "document", "Document status");
    const latestJob = isRecord(payload.latest_job) ? payload.latest_job : null;
    lastDocument = document;
    lastJob = latestJob;
    addObservedStatus(observedDocumentStatuses, document.status);
    addObservedStatus(observedJobStatuses, latestJob?.status);

    if (
      document.status === "failed" ||
      latestJob?.status === "failed" ||
      latestJob?.status === "retry"
    ) {
      throw new Error(`Document processing failed: ${failureDetails(document, latestJob)}`);
    }

    if (document.status === "ready") {
      let completedJob = latestJob;

      if (!completedJob || completedJob.id !== input.processingJobId) {
        const jobPayload = await requestJson(
          "Processing job status",
          apiUrl(
            input.baseUrl,
            `/api/v1/processing-jobs/${encodeURIComponent(input.processingJobId)}`,
          ),
          { method: "GET" },
          Math.min(input.requestTimeoutMs, 30_000),
        );
        completedJob = requiredRecord(jobPayload, "job", "Processing job status");
        addObservedStatus(observedJobStatuses, completedJob.status);
      }

      if (completedJob.status !== "completed") {
        throw new Error(
          `Document became READY before its processing job completed: ${failureDetails(document, completedJob)}`,
        );
      }

      return { document, job: completedJob, observedDocumentStatuses, observedJobStatuses };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await delay(Math.min(pollingDelayMs, remainingMs));
    pollingDelayMs = Math.min(5_000, Math.ceil(pollingDelayMs * 1.5));
  }

  throw new Error(
    `Document did not become READY within ${input.pipelineTimeoutMs}ms: ${failureDetails(lastDocument ?? {}, lastJob)}`,
  );
}

function verifyReadyState(ready: ReadyResult): void {
  const chunkCount = finiteNumber(ready.document.chunk_count);
  const progress = finiteNumber(ready.document.progress_pct);

  if (
    ready.document.status !== "ready" ||
    ready.document.processing_stage !== "finalize" ||
    progress !== 100 ||
    !requiredString(ready.document, "parser_name", "READY document") ||
    !requiredString(ready.document, "parser_version", "READY document") ||
    !requiredString(ready.document, "processed_at", "READY document") ||
    chunkCount === null ||
    chunkCount < 1
  ) {
    throw new Error("READY document is missing final processing provenance.");
  }

  if (
    ready.job.status !== "completed" ||
    ready.job.stage !== "finalize" ||
    finiteNumber(ready.job.progress_pct) !== 100 ||
    finiteNumber(ready.job.attempt) === null ||
    !requiredString(ready.job, "finished_at", "Completed processing job")
  ) {
    throw new Error("Processing job is missing its completed lifecycle state.");
  }
}

async function verifyChunks(input: {
  supabase: SupabaseClient;
  documentId: string;
  fixtureKey: string;
  expectedCount: number;
}): Promise<VerifiedChunk[]> {
  const { data, error } = await input.supabase
    .from("document_chunks")
    .select(
      "id,document_id,chunk_index,text,section_path,metadata,embedding,embedding_status,embedding_provider,embedding_model,embedding_model_version,embedding_dimension,embedded_at",
    )
    .eq("document_id", input.documentId)
    .order("chunk_index", { ascending: true });

  if (error || !Array.isArray(data)) {
    throw new Error(`Processed chunks could not be read (${error?.code ?? "unknown"}).`);
  }

  const rows = data.filter(isRecord);
  if (rows.length < 1 || rows.length !== input.expectedCount) {
    throw new Error(
      `READY chunk count mismatch: document=${input.expectedCount}, persisted=${rows.length}.`,
    );
  }

  const verified = rows.map((row, index) => {
    const id = requiredString(row, "id", `Chunk ${index}`);
    const text = requiredString(row, "text", `Chunk ${index}`);
    const metadata = requiredRecord(row, "metadata", `Chunk ${index}`);
    const evidence = requiredRecord(metadata, "evidence", `Chunk ${index} metadata`);
    const sourceSegments = evidence.sourceSegments;
    const embeddingModel = requiredString(row, "embedding_model", `Chunk ${index}`);

    if (row.document_id !== input.documentId) {
      throw new Error(`Chunk ${id} is not linked to the uploaded Source Document.`);
    }
    if (evidence.sourceDocumentId !== input.documentId) {
      throw new Error(`Chunk ${id} is missing Evidence-to-Source metadata.`);
    }
    if (!Array.isArray(sourceSegments) || sourceSegments.length === 0) {
      throw new Error(`Chunk ${id} does not preserve a source locator segment.`);
    }
    if (
      row.embedding === null ||
      row.embedding === undefined ||
      row.embedding_status !== "ready" ||
      !requiredString(row, "embedding_provider", `Chunk ${index}`) ||
      !requiredString(row, "embedding_model_version", `Chunk ${index}`) ||
      finiteNumber(row.embedding_dimension) !== EMBEDDING_DIMENSION ||
      !requiredString(row, "embedded_at", `Chunk ${index}`)
    ) {
      throw new Error(`Chunk ${id} is missing a READY embedding or embedding provenance.`);
    }

    return { id, text, embeddingModel };
  });

  if (!verified.some((chunk) => chunk.text.includes(input.fixtureKey))) {
    throw new Error("Processed chunks do not contain the unique staging fixture marker.");
  }

  return verified;
}

async function verifyProcessingJobPersistence(input: {
  supabase: SupabaseClient;
  documentId: string;
  processingJobId: string;
}): Promise<{ attempt: number; embeddingModel: string }> {
  const { data, error } = await input.supabase
    .from("document_processing_jobs")
    .select(
      "id,document_id,status,stage,attempt,progress_pct,config,started_at,finished_at,error_code,error_message",
    )
    .eq("id", input.processingJobId)
    .eq("document_id", input.documentId)
    .single();

  if (error || !isRecord(data)) {
    throw new Error(`Processing Job was not persisted (${error?.code ?? "unknown"}).`);
  }

  const config = requiredRecord(data, "config", "Persisted Processing Job");
  const attempt = finiteNumber(data.attempt);
  const embeddingModel = requiredString(
    config,
    "embeddingModel",
    "Persisted Processing Job config",
  );

  if (
    data.status !== "completed" ||
    data.stage !== "finalize" ||
    finiteNumber(data.progress_pct) !== 100 ||
    attempt === null ||
    attempt < 1 ||
    !requiredString(data, "started_at", "Persisted Processing Job") ||
    !requiredString(data, "finished_at", "Persisted Processing Job") ||
    !requiredString(config, "embeddingProvider", "Persisted Processing Job config") ||
    !requiredString(config, "embeddingModelVersion", "Persisted Processing Job config") ||
    finiteNumber(config.embeddingDimension) !== EMBEDDING_DIMENSION
  ) {
    throw new Error("Persisted Processing Job is missing lifecycle or embedding audit fields.");
  }

  return { attempt, embeddingModel };
}

function verifyMetric(quality: JsonRecord, key: string): MetricResult {
  const value = requiredRecord(quality, key, "QA quality scores");
  const score = finiteNumber(value.score);
  const explanation = requiredString(value, "explanation", `Metric ${key}`);

  if (score === null || score < 0 || score > 100) {
    throw new Error(`Metric ${key} did not return a score between 0 and 100.`);
  }

  if (!isRecord(value.details)) {
    throw new Error(`Metric ${key} did not return evaluation details.`);
  }

  return { score, explanation };
}

async function verifyQaPersistence(input: {
  supabase: SupabaseClient;
  qaRunId: string;
  documentId: string;
  chunkIds: ReadonlySet<string>;
}): Promise<{ retrievalCount: number; claimCount: number; evidenceCount: number }> {
  const [runResult, retrievalResult, claimResult, evidenceResult] = await Promise.all([
    input.supabase
      .from("qa_runs")
      .select(
        "id,status,answer_payload,retrieval_score,evidence_coverage_score,knowledge_match_score,confidence_score",
      )
      .eq("id", input.qaRunId)
      .single(),
    input.supabase
      .from("retrieval_results")
      .select(
        "id,chunk_id,document_id,rank,relevance_score,selected,document_name_snapshot,chunk_text_snapshot,locator_snapshot",
      )
      .eq("qa_run_id", input.qaRunId),
    input.supabase
      .from("answer_claims")
      .select("id,support_status", { count: "exact" })
      .eq("qa_run_id", input.qaRunId),
    input.supabase
      .from("evidence_items")
      .select("id,chunk_id,document_id,quote_text", { count: "exact" })
      .eq("qa_run_id", input.qaRunId),
  ]);

  if (runResult.error || !isRecord(runResult.data) || runResult.data.status !== "completed") {
    throw new Error(`Completed QA Run was not persisted (${runResult.error?.code ?? "unknown"}).`);
  }
  if (!isRecord(runResult.data.answer_payload)) {
    throw new Error("QA Run persistence is missing the structured Answer payload.");
  }
  for (const key of [
    "retrieval_score",
    "evidence_coverage_score",
    "knowledge_match_score",
    "confidence_score",
  ] as const) {
    if (finiteNumber(runResult.data[key]) === null) {
      throw new Error(`QA Run persistence is missing ${key}.`);
    }
  }

  if (retrievalResult.error || !Array.isArray(retrievalResult.data)) {
    throw new Error(
      `QA retrieval trace could not be read (${retrievalResult.error?.code ?? "unknown"}).`,
    );
  }
  const retrievalRows = retrievalResult.data.filter(isRecord);
  for (const row of retrievalRows) {
    requiredString(row, "id", "Persisted Retrieval Result");
    requiredString(row, "chunk_id", "Persisted Retrieval Result");
    requiredString(row, "document_id", "Persisted Retrieval Result");
    requiredString(row, "document_name_snapshot", "Persisted Retrieval Result");
    requiredString(row, "chunk_text_snapshot", "Persisted Retrieval Result");
    requiredRecord(row, "locator_snapshot", "Persisted Retrieval Result");
    if (finiteNumber(row.rank) === null || finiteNumber(row.relevance_score) === null) {
      throw new Error("Persisted Retrieval Result is missing rank or relevance score.");
    }
  }
  if (
    !retrievalRows.some(
      (row) =>
        row.selected === true &&
        row.document_id === input.documentId &&
        typeof row.chunk_id === "string" &&
        input.chunkIds.has(row.chunk_id),
    )
  ) {
    throw new Error("QA Run did not persist a selected retrieval result from the uploaded document.");
  }

  if (claimResult.error || !claimResult.count) {
    throw new Error(`QA Claim trace was not persisted (${claimResult.error?.code ?? "unknown"}).`);
  }
  if (evidenceResult.error || !evidenceResult.count || !Array.isArray(evidenceResult.data)) {
    throw new Error(
      `QA Evidence trace was not persisted (${evidenceResult.error?.code ?? "unknown"}).`,
    );
  }
  if (
    !evidenceResult.data.some(
      (row) =>
        isRecord(row) &&
        row.document_id === input.documentId &&
        typeof row.chunk_id === "string" &&
        input.chunkIds.has(row.chunk_id),
    )
  ) {
    throw new Error("Persisted Evidence does not trace to the uploaded Source Document.");
  }

  return {
    retrievalCount: retrievalRows.length,
    claimCount: claimResult.count,
    evidenceCount: evidenceResult.count,
  };
}

async function cleanupSmokeResources(input: {
  supabase: SupabaseClient;
  resources: SmokeResources;
  knowledgeBaseId: string;
  query: string;
  startedAt: string;
}): Promise<string[]> {
  const errors: string[] = [];
  const qaRunIds = new Set<string>();
  const conversationIds = new Set<string>();

  if (input.resources.qaRunId) qaRunIds.add(input.resources.qaRunId);
  if (input.resources.conversationId) conversationIds.add(input.resources.conversationId);

  const { data: discoveredRuns, error: runLookupError } = await input.supabase
    .from("qa_runs")
    .select("id,conversation_id")
    .eq("query", input.query)
    .gte("created_at", input.startedAt);

  if (runLookupError) {
    errors.push(`qa_run_lookup:${runLookupError.code}`);
  } else if (Array.isArray(discoveredRuns)) {
    for (const row of discoveredRuns) {
      if (!isRecord(row)) continue;
      if (typeof row.id === "string") qaRunIds.add(row.id);
      if (typeof row.conversation_id === "string") conversationIds.add(row.conversation_id);
    }
  }

  const { error: insightError } = await input.supabase
    .from("knowledge_insight_logs")
    .delete()
    .eq("knowledge_base_id", input.knowledgeBaseId)
    .eq("question_text", input.query)
    .gte("created_at", input.startedAt);
  if (insightError) errors.push(`knowledge_insights:${insightError.code}`);

  if (qaRunIds.size > 0) {
    const { error } = await input.supabase
      .from("knowledge_insight_logs")
      .delete()
      .in("latest_qa_run_id", [...qaRunIds]);
    if (error) errors.push(`knowledge_insights_by_run:${error.code}`);
  }

  if (conversationIds.size > 0) {
    const { error } = await input.supabase
      .from("conversations")
      .delete()
      .in("id", [...conversationIds]);
    if (error) errors.push(`conversations:${error.code}`);
  }

  if (input.resources.documentId) {
    if (input.resources.storageBucket && input.resources.storagePath) {
      const { error } = await input.supabase.storage
        .from(input.resources.storageBucket)
        .remove([input.resources.storagePath]);
      if (error) errors.push(`storage:${error.message}`);
    }

    const { error: documentError } = await input.supabase
      .from("documents")
      .delete()
      .eq("id", input.resources.documentId);
    if (documentError) errors.push(`document:${documentError.code}`);
  }

  return errors;
}

async function main(): Promise<void> {
  await loadDotEnv(ENV_PATH);

  const baseUrl = environment("QA_SMOKE_URL");
  const supabaseUrl = environment("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey =
    environment("NEXT_PUBLIC_SUPABASE_ANON_KEY") ??
    environment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = environment("SUPABASE_SERVICE_ROLE_KEY");
  const missing = [
    ["QA_SMOKE_URL", baseUrl],
    ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", supabaseAnonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey],
  ]
    .filter(([, value]) => value === null)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.log(
      JSON.stringify(
        {
          status: "PHASE6_STAGING_SMOKE_SKIPPED",
          reason: `Missing required environment variables: ${missing.join(", ")}`,
        },
        null,
        2,
      ),
    );
    return;
  }

  const pipelineTimeoutMs = boundedIntegerEnvironment(
    "PHASE6_SMOKE_TIMEOUT_MS",
    DEFAULT_PIPELINE_TIMEOUT_MS,
    10_000,
    600_000,
  );
  const requestTimeoutMs = boundedIntegerEnvironment(
    "PHASE6_SMOKE_REQUEST_TIMEOUT_MS",
    DEFAULT_REQUEST_TIMEOUT_MS,
    5_000,
    300_000,
  );
  const knowledgeBaseId =
    environment("QA_SMOKE_KNOWLEDGE_BASE_ID") ??
    environment("DEFAULT_KNOWLEDGE_BASE_ID") ??
    DEFAULT_KNOWLEDGE_BASE_ID;
  const health = await requestJson(
    "Release health check",
    apiUrl(baseUrl!, "/api/v1/health"),
    { method: "GET" },
    Math.min(requestTimeoutMs, 15_000),
  );

  if (health.status !== "ready") {
    throw new Error(`Release health check is not ready: ${sanitizedPayload(health)}.`);
  }
  const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const browserSupabase = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const fixtureId = randomUUID();
  const fixtureKey = `NoveraPhase6-${fixtureId}`;
  const fixtureText = [
    "# Novera Phase 6 Staging Evidence",
    "",
    `Fixture marker: ${fixtureKey}`,
    "",
    "## Verified activation issue",
    "The verified activation issue is that new users cannot find the next-step checklist immediately after signup.",
    "",
    "## Approved product response",
    "The approved product response is to place the checklist on the first workspace screen.",
    "The success metric is first-task completion within 24 hours.",
  ].join("\n");
  const fixtureBytes = Buffer.from(fixtureText, "utf8");
  const query = [
    `Using only the ${fixtureKey} source, analyze the verified activation issue,`,
    "the approved product response, and the success metric.",
  ].join(" ");
  const startedAt = new Date().toISOString();
  const resources: SmokeResources = {
    documentId: null,
    storageBucket: null,
    storagePath: null,
    qaRunId: null,
    conversationId: null,
  };
  let passedResult: JsonRecord | null = null;
  let primaryError: unknown = null;

  try {
    const initPayload = await requestJson(
      "Document upload initialization",
      apiUrl(baseUrl!, "/api/v1/documents/init"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: `Phase 6 Staging Evidence ${fixtureKey}`,
          knowledge_base_id: knowledgeBaseId,
          filename: `phase6-staging-${fixtureId}.md`,
          mime_type: FIXTURE_MIME_TYPE,
          size_bytes: fixtureBytes.byteLength,
          sha256: sha256(fixtureText),
        }),
      },
      requestTimeoutMs,
    );
    const initializedDocument = requiredRecord(
      initPayload,
      "document",
      "Document upload initialization",
    );
    const initializedUpload = requiredRecord(
      initPayload,
      "upload",
      "Document upload initialization",
    );
    const documentId = requiredString(
      initializedDocument,
      "id",
      "Document upload initialization",
    );
    const storageBucket = requiredString(
      initializedUpload,
      "bucket",
      "Document upload initialization",
    );
    const storagePath = requiredString(
      initializedUpload,
      "path",
      "Document upload initialization",
    );
    const uploadToken = requiredString(
      initializedUpload,
      "token",
      "Document upload initialization",
    );
    const signedUrl = requiredString(
      initializedUpload,
      "signed_url",
      "Document upload initialization",
    );
    apiUrl(signedUrl, "/");
    resources.documentId = documentId;
    resources.storageBucket = storageBucket;
    resources.storagePath = storagePath;

    if (initializedDocument.status !== "uploading") {
      throw new Error(
        `Initialized document must be uploading, received ${String(initializedDocument.status)}.`,
      );
    }

    const { data: uploadData, error: uploadError } = await browserSupabase.storage
      .from(storageBucket)
      .uploadToSignedUrl(storagePath, uploadToken, fixtureBytes, {
        cacheControl: "0",
        contentType: FIXTURE_MIME_TYPE,
        upsert: false,
      });

    if (uploadError || !uploadData?.path) {
      throw new Error(`Signed Storage upload failed: ${uploadError?.message ?? "no path returned"}.`);
    }

    const completePayload = await requestJson(
      "Document upload completion",
      apiUrl(baseUrl!, `/api/v1/documents/${encodeURIComponent(documentId)}/complete`),
      { method: "POST" },
      requestTimeoutMs,
    );
    const completedUploadDocument = requiredRecord(
      completePayload,
      "document",
      "Document upload completion",
    );
    const completeProcessing = isRecord(completePayload.processing)
      ? completePayload.processing
      : null;
    const completeJob = completeProcessing && isRecord(completeProcessing.job)
      ? completeProcessing.job
      : null;

    if (!["uploaded", "processing", "ready"].includes(String(completedUploadDocument.status))) {
      throw new Error(
        `Completed upload returned invalid status ${String(completedUploadDocument.status)}.`,
      );
    }

    const processPayload = await requestJson(
      "Document processing trigger",
      apiUrl(baseUrl!, `/api/v1/documents/${encodeURIComponent(documentId)}/process`),
      { method: "POST" },
      requestTimeoutMs,
    );
    const processDocument = requiredRecord(
      processPayload,
      "document",
      "Document processing trigger",
    );
    const processJob = requiredRecord(processPayload, "job", "Document processing trigger");
    const processingJobId = requiredString(processJob, "id", "Document processing trigger");
    const initialDocumentStatuses: string[] = [];
    const initialJobStatuses: string[] = [];
    addObservedStatus(initialDocumentStatuses, initializedDocument.status);
    addObservedStatus(initialDocumentStatuses, completedUploadDocument.status);
    addObservedStatus(initialDocumentStatuses, processDocument.status);
    addObservedStatus(initialJobStatuses, completeJob?.status);
    addObservedStatus(initialJobStatuses, processJob.status);

    const ready = await pollUntilReady({
      baseUrl: baseUrl!,
      documentId,
      processingJobId,
      pipelineTimeoutMs,
      requestTimeoutMs,
      initialDocumentStatuses,
      initialJobStatuses,
    });
    verifyReadyState(ready);
    const persistedProcessingJob = await verifyProcessingJobPersistence({
      supabase,
      documentId,
      processingJobId,
    });
    const expectedChunkCount = finiteNumber(ready.document.chunk_count);

    if (expectedChunkCount === null) {
      throw new Error("READY document did not expose its chunk count.");
    }

    const chunks = await verifyChunks({
      supabase,
      documentId,
      fixtureKey,
      expectedCount: expectedChunkCount,
    });
    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const chunkIds = new Set(chunkById.keys());
    const qaPayload = await requestJson(
      "Evidence-backed QA Run",
      apiUrl(baseUrl!, "/api/v1/qa/runs"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          knowledge_base_id: knowledgeBaseId,
          task_type: "analysis",
          document_ids: [documentId],
          top_k: 5,
          similarity_threshold: 0.2,
        }),
      },
      requestTimeoutMs,
    );
    const qaRunId = requiredString(qaPayload, "qa_run_id", "Evidence-backed QA Run");
    const conversationId = requiredString(
      qaPayload,
      "conversation_id",
      "Evidence-backed QA Run",
    );
    resources.qaRunId = qaRunId;
    resources.conversationId = conversationId;

    if (qaPayload.status !== "completed") {
      throw new Error(`Expected completed QA status, received ${String(qaPayload.status)}.`);
    }

    const answer = requiredRecord(qaPayload, "answer", "Evidence-backed QA Run");
    requiredString(answer, "answer", "Evidence-backed QA Run answer");
    if (answer.insufficient_evidence !== false) {
      throw new Error("The deterministic staging fixture produced insufficient evidence.");
    }

    const claims = Array.isArray(answer.claims) ? answer.claims.filter(isRecord) : [];
    const sources = Array.isArray(qaPayload.sources) ? qaPayload.sources.filter(isRecord) : [];
    const evidence = claims.flatMap((claim) =>
      Array.isArray(claim.evidence) ? claim.evidence.filter(isRecord) : [],
    );

    if (claims.length === 0) throw new Error("QA response did not contain any Claims.");
    if (evidence.length === 0) throw new Error("QA response did not contain verified Evidence.");
    const uploadedSource = sources.find((source) => source.document_id === documentId);
    if (!uploadedSource) {
      throw new Error("QA response did not include the uploaded Source Document.");
    }
    requiredString(uploadedSource, "document_name", "QA Source Document");
    if ((finiteNumber(uploadedSource.document_version) ?? 0) < 1) {
      throw new Error("QA Source Document is missing its version snapshot.");
    }
    requiredRecord(uploadedSource, "locator", "QA Source Document");

    for (const item of evidence) {
      const evidenceDocumentId = requiredString(item, "document_id", "QA Evidence");
      const evidenceChunkId = requiredString(item, "chunk_id", "QA Evidence");
      const quote = requiredString(item, "quote", "QA Evidence");
      const locator = requiredRecord(item, "locator", "QA Evidence");
      const sourceChunk = chunkById.get(evidenceChunkId);

      if (evidenceDocumentId !== documentId || !sourceChunk) {
        throw new Error("QA Evidence does not trace to a retrieved chunk in the uploaded document.");
      }
      if (!sourceChunk.text.includes(quote)) {
        throw new Error("QA Evidence quote is not an exact substring of the persisted source chunk.");
      }
      if (Object.values(locator).every((value) => value === null || value === undefined)) {
        throw new Error("QA Evidence does not expose an original-source locator.");
      }
    }

    const retrieval = requiredRecord(qaPayload, "retrieval", "Evidence-backed QA Run");
    const retrievalResultCount = finiteNumber(retrieval.result_count);
    const retrievalSelectedCount = finiteNumber(retrieval.selected_count);
    if (
      retrievalResultCount === null ||
      retrievalResultCount < 1 ||
      retrievalSelectedCount === null ||
      retrievalSelectedCount < 1
    ) {
      throw new Error("QA response did not report retrieved and selected chunks.");
    }

    const quality = requiredRecord(qaPayload, "quality_scores", "Evidence-backed QA Run");
    const metrics = {
      retrieval: verifyMetric(quality, "retrieval_score"),
      evidenceCoverage: verifyMetric(quality, "evidence_coverage"),
      knowledgeMatch: verifyMetric(quality, "knowledge_match"),
      confidence: verifyMetric(quality, "confidence"),
    };
    const runStats = requiredRecord(qaPayload, "run_stats", "Evidence-backed QA Run");
    const tokens = requiredRecord(runStats, "tokens", "Evidence-backed QA Run stats");
    const latencyMs = finiteNumber(runStats.latency_ms);
    const estimatedCostUsd = finiteNumber(runStats.estimated_cost_usd);

    if (latencyMs === null || latencyMs < 0) {
      throw new Error("QA response did not report a valid latency.");
    }
    if (estimatedCostUsd === null || estimatedCostUsd < 0) {
      throw new Error("QA response did not report an estimated cost.");
    }
    if (
      finiteNumber(tokens.query_embedding) === null ||
      finiteNumber(tokens.generation_input) === null ||
      finiteNumber(tokens.generation_output) === null
    ) {
      throw new Error("QA response did not report complete embedding and generation usage.");
    }
    const persisted = await verifyQaPersistence({
      supabase,
      qaRunId,
      documentId,
      chunkIds,
    });

    passedResult = {
      status: "PHASE6_STAGING_SMOKE_PASSED",
      chain: [
        "upload",
        "processing",
        "ready",
        "retrieval",
        "qa_run",
        "evidence",
        "metrics",
      ],
      document_id: documentId,
      processing_job_id: processingJobId,
      processing_attempt: persistedProcessingJob.attempt,
      qa_run_id: qaRunId,
      observed_document_statuses: ready.observedDocumentStatuses,
      observed_job_statuses: ready.observedJobStatuses,
      parser: {
        name: ready.document.parser_name,
        version: ready.document.parser_version,
      },
      chunks: {
        count: chunks.length,
        embedding_model: chunks[0]?.embeddingModel ?? null,
        job_embedding_model: persistedProcessingJob.embeddingModel,
        embedding_dimension: EMBEDDING_DIMENSION,
      },
      retrieval: {
        response_results: retrievalResultCount,
        response_selected: retrievalSelectedCount,
        persisted_results: persisted.retrievalCount,
      },
      evidence: {
        claims: persisted.claimCount,
        evidence_items: persisted.evidenceCount,
        response_sources: sources.length,
      },
      metrics: {
        retrieval_score: metrics.retrieval.score,
        evidence_coverage: metrics.evidenceCoverage.score,
        knowledge_match: metrics.knowledgeMatch.score,
        confidence: metrics.confidence.score,
      },
      operations: {
        latency_ms: latencyMs,
        estimated_cost_usd: estimatedCostUsd,
        pricing_source: runStats.pricing_source,
        tokens,
      },
      trace_id: qaPayload.trace_id,
    };
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors = await cleanupSmokeResources({
    supabase,
    resources,
    knowledgeBaseId,
    query,
    startedAt,
  });

  if (primaryError) {
    if (cleanupErrors.length > 0) {
      console.warn(`PHASE6_STAGING_SMOKE_CLEANUP_WARNINGS ${cleanupErrors.join(", ")}`);
    }
    throw primaryError;
  }

  if (!passedResult) {
    throw new Error("Phase 6 smoke ended without a result.");
  }

  console.log(
    JSON.stringify(
      {
        ...passedResult,
        cleanup: {
          status: cleanupErrors.length === 0 ? "completed" : "partial",
          errors: cleanupErrors,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(
    `PHASE6_STAGING_SMOKE_FAILED ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
