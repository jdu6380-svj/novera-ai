import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type JsonRecord = Record<string, unknown>;

interface GoldenEvidence {
  documentFixtureId: string;
  quote: string;
}

interface GoldenCase {
  id: string;
  question: string;
  taskType: string;
  expectedOutcome: "supported" | "insufficient_evidence";
  expectedDocuments: string[];
  expectedEvidence: GoldenEvidence[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index] ?? null;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function threshold(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1.`);
  }
  return value;
}

function shouldUseVercelCurl(): boolean {
  const value = process.env.PORTFOLIO_EVAL_USE_VERCEL_CURL?.trim().toLowerCase();
  return value === "1" || value === "true";
}

function parseJsonObject(text: string, label: string): JsonRecord {
  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  const candidate = firstObject >= 0 && lastObject >= firstObject
    ? text.slice(firstObject, lastObject + 1)
    : text.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new Error(`${label} did not return JSON.`, { cause: error });
  }

  if (!isRecord(parsed)) {
    throw new Error(`${label} did not return a JSON object.`);
  }

  return parsed;
}

async function requestQa(
  endpoint: URL,
  body: JsonRecord,
  timeoutMs: number,
): Promise<JsonRecord> {
  if (shouldUseVercelCurl()) {
    const deployment = process.env.PORTFOLIO_EVAL_DEPLOYMENT?.trim();
    if (!deployment) {
      throw new Error("PORTFOLIO_EVAL_DEPLOYMENT is required with Vercel curl mode.");
    }

    const vercelBin = process.env.PORTFOLIO_EVAL_VERCEL_BIN?.trim() || "vercel";
    try {
      const result = await execFileAsync(
        vercelBin,
        [
          "curl",
          endpoint.pathname + endpoint.search,
          "--deployment",
          deployment,
          "--",
          "--silent",
          "--show-error",
          "--fail-with-body",
          "--request",
          "POST",
          "--header",
          "content-type: application/json",
          "--data",
          JSON.stringify(body),
        ],
        { env: process.env, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      );
      return parseJsonObject(result.stdout, "Portfolio QA request");
    } catch (error) {
      const stdout = isRecord(error) && typeof error.stdout === "string" ? error.stdout : "";
      const stderr = isRecord(error) && typeof error.stderr === "string" ? error.stderr : "";
      throw new Error(
        `Portfolio QA request failed via vercel curl: ${`${stdout}\n${stderr}`.trim().slice(0, 2_000)}`,
        { cause: error },
      );
    }
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const rawBody = (await response.json().catch(() => undefined)) as unknown;

  if (!response.ok) {
    throw new Error(`QA API returned HTTP ${response.status}: ${JSON.stringify(rawBody)}`);
  }

  return asRecord(rawBody, "QA response");
}

async function main(): Promise<void> {
  const baseUrl = process.env.PORTFOLIO_EVAL_API_URL?.trim();

  if (!baseUrl) {
    console.error("PORTFOLIO_EVAL_SKIPPED missing PORTFOLIO_EVAL_API_URL.");
    process.exitCode = 2;
    return;
  }

  const manifest = asRecord(
    JSON.parse(await readFile(resolve("demo/manifest.json"), "utf8")) as unknown,
    "Demo manifest",
  );
  const documents = asArray(manifest.documents).map((value) => asRecord(value, "Document"));
  const documentNames = new Map(
    documents.map((document) => [
      asString(document.fixtureDocumentId),
      asString(document.filename).replace(/\.[^.]+$/u, ""),
    ]),
  );
  const cases = [
    ...asArray(manifest.typicalQuestions),
    ...asArray(manifest.knowledgeGapCases),
  ].map((value): GoldenCase => {
    const row = asRecord(value, "Golden case");
    return {
      id: asString(row.id),
      question: asString(row.question),
      taskType: asString(row.taskType),
      expectedOutcome: asString(row.expectedOutcome) as GoldenCase["expectedOutcome"],
      expectedDocuments: asArray(row.expectedDocuments).map(asString),
      expectedEvidence: asArray(row.expectedEvidence).map((evidence) => {
        const item = asRecord(evidence, "Golden evidence");
        return {
          documentFixtureId: asString(item.documentFixtureId),
          quote: asString(item.quote),
        };
      }),
    };
  });

  const requestedCaseIds = (process.env.PORTFOLIO_EVAL_CASE_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const selectedCases = requestedCaseIds.length > 0
    ? cases.filter((goldenCase) => requestedCaseIds.includes(goldenCase.id))
    : cases;

  if (requestedCaseIds.length > 0 && selectedCases.length !== requestedCaseIds.length) {
    const selectedIds = new Set(selectedCases.map((goldenCase) => goldenCase.id));
    const missing = requestedCaseIds.filter((id) => !selectedIds.has(id));
    throw new Error(`Unknown portfolio evaluation case ids: ${missing.join(", ")}`);
  }

  if (selectedCases.length < 1 || (!requestedCaseIds.length && (selectedCases.length < 15 || selectedCases.length > 20))) {
    throw new Error(`Portfolio evaluation requires 15–20 cases by default; received ${selectedCases.length}.`);
  }

  const endpoint = new URL("/api/v1/qa/runs", baseUrl);
  const knowledgeBaseId =
    process.env.PORTFOLIO_EVAL_KNOWLEDGE_BASE_ID?.trim() ||
    "00000000-0000-4000-8000-000000000001";
  const caseResults = [];

  for (const goldenCase of selectedCases) {
    const startedAt = Date.now();
    const body = await requestQa(
      endpoint,
      {
        query: goldenCase.question,
        knowledge_base_id: knowledgeBaseId,
        task_type: goldenCase.taskType,
      },
      Number(process.env.PORTFOLIO_EVAL_REQUEST_TIMEOUT_MS ?? 180_000),
    );
    const answer = asRecord(body.answer, `Answer for ${goldenCase.id}`);
    const quality = asRecord(body.quality_scores, `Quality for ${goldenCase.id}`);
    const confidence = asRecord(quality.confidence, `Confidence for ${goldenCase.id}`);
    const runStats = asRecord(body.run_stats, `Run stats for ${goldenCase.id}`);
    const claims = asArray(answer.claims).map((claim) => asRecord(claim, "Claim"));
    const returnedEvidence = claims.flatMap((claim) =>
      asArray(claim.evidence).map((evidence) => asRecord(evidence, "Evidence")),
    );
    const returnedSources = asArray(body.sources).map((source) => asRecord(source, "Source"));
    const insufficient = body.status === "insufficient_evidence" &&
      answer.insufficient_evidence === true;
    const expectedInsufficient = goldenCase.expectedOutcome === "insufficient_evidence";
    const outcomePass = expectedInsufficient ? insufficient : !insufficient;
    const expectedDocumentNames = goldenCase.expectedDocuments
      .map((id) => documentNames.get(id) ?? id)
      .map(normalize);
    const returnedDocumentNames = returnedSources
      .map((source) => normalize(asString(source.document_name)));
    const matchedDocuments = expectedDocumentNames.filter((expected) =>
      returnedDocumentNames.some(
        (actual) => actual.includes(expected) || expected.includes(actual),
      ),
    );
    let matchedReturnedEvidence = 0;
    const matchedGoldenEvidence = new Set<number>();

    for (const evidence of returnedEvidence) {
      const quote = asString(evidence.quote);
      const documentName = normalize(asString(evidence.document_name));
      const matchIndex = goldenCase.expectedEvidence.findIndex((expected) => {
        const expectedName = normalize(
          documentNames.get(expected.documentFixtureId) ?? expected.documentFixtureId,
        );
        const documentMatches =
          documentName.includes(expectedName) || expectedName.includes(documentName);
        const quoteMatches = expected.quote.includes(quote) || quote.includes(expected.quote);
        return documentMatches && quoteMatches;
      });

      if (matchIndex >= 0) {
        matchedReturnedEvidence += 1;
        matchedGoldenEvidence.add(matchIndex);
      }
    }

    const citationPrecision = expectedInsufficient
      ? returnedEvidence.length === 0 ? 1 : 0
      : ratio(matchedReturnedEvidence, returnedEvidence.length);
    const citationRecall = expectedInsufficient
      ? 1
      : ratio(matchedGoldenEvidence.size, goldenCase.expectedEvidence.length);
    const confidenceScore = asNumber(confidence.score);
    const latencyMs = asNumber(runStats.latency_ms) ?? Date.now() - startedAt;

    caseResults.push({
      case_id: goldenCase.id,
      category: expectedInsufficient
        ? "refusal"
        : goldenCase.expectedDocuments.length > 1
          ? "cross_document"
          : "supported",
      expected_outcome: goldenCase.expectedOutcome,
      actual_status: asString(body.status),
      outcome_pass: outcomePass,
      retrieval_hit: expectedInsufficient
        ? null
        : matchedDocuments.length === expectedDocumentNames.length,
      expected_document_count: expectedDocumentNames.length,
      matched_document_count: matchedDocuments.length,
      citation_precision: citationPrecision,
      citation_recall: citationRecall,
      confidence_score: confidenceScore,
      refusal_confidence_boundary_pass:
        expectedInsufficient ? confidenceScore !== null && confidenceScore < 50 : null,
      latency_ms: latencyMs,
      estimated_cost_usd: asNumber(runStats.estimated_cost_usd),
      pricing_source: asString(runStats.pricing_source),
      qa_run_id: asString(body.qa_run_id),
      trace_id: asString(body.trace_id),
    });
  }

  const supportedResults = caseResults.filter((result) => result.category !== "refusal");
  const refusalResults = caseResults.filter((result) => result.category === "refusal");
  const latencies = caseResults.map((result) => result.latency_ms);
  const costs = caseResults
    .map((result) => result.estimated_cost_usd)
    .filter((value): value is number => value !== null);
  const aggregate = {
    case_count: caseResults.length,
    supported_case_count: supportedResults.length,
    cross_document_case_count: caseResults.filter(
      (result) => result.category === "cross_document",
    ).length,
    refusal_case_count: refusalResults.length,
    outcome_accuracy: ratio(
      caseResults.filter((result) => result.outcome_pass).length,
      caseResults.length,
    ),
    retrieval_hit_rate: ratio(
      supportedResults.filter((result) => result.retrieval_hit).length,
      supportedResults.length,
    ),
    citation_precision: Number(
      (supportedResults.reduce((sum, result) => sum + result.citation_precision, 0) /
        supportedResults.length).toFixed(4),
    ),
    citation_recall: Number(
      (supportedResults.reduce((sum, result) => sum + result.citation_recall, 0) /
        supportedResults.length).toFixed(4),
    ),
    refusal_accuracy: ratio(
      refusalResults.filter(
        (result) => result.outcome_pass && result.refusal_confidence_boundary_pass,
      ).length,
      refusalResults.length,
    ),
    latency_ms: {
      average: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
      p95: percentile(latencies, 0.95),
      maximum: Math.max(...latencies),
    },
    estimated_cost_usd: {
      total: costs.length > 0
        ? Number(costs.reduce((sum, value) => sum + value, 0).toFixed(8))
        : null,
      average_per_question: costs.length > 0
        ? Number((costs.reduce((sum, value) => sum + value, 0) / costs.length).toFixed(8))
        : null,
      priced_case_count: costs.length,
    },
  };
  const report = {
    schema_version: "1.0",
    dataset_id: asString(manifest.datasetId),
    evaluation_set_id: process.env.PORTFOLIO_EVAL_SET_ID?.trim() || "portfolio-full-v1",
    evaluated_at: new Date().toISOString(),
    api_url: baseUrl,
    knowledge_base_id: knowledgeBaseId,
    data_classification: "fictional_demo_corpus_processed_by_live_rag",
    aggregate,
    cases: caseResults,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;

  console.log(serialized);

  const outputPath = process.env.PORTFOLIO_EVAL_OUTPUT?.trim();
  if (outputPath) {
    await writeFile(resolve(outputPath), serialized, "utf8");
  }

  const gates = {
    outcomeAccuracy: threshold("PORTFOLIO_EVAL_MIN_OUTCOME_ACCURACY", 0.85),
    retrievalHitRate: threshold("PORTFOLIO_EVAL_MIN_RETRIEVAL_HIT_RATE", 0.8),
    citationPrecision: threshold("PORTFOLIO_EVAL_MIN_CITATION_PRECISION", 0.8),
    citationRecall: threshold("PORTFOLIO_EVAL_MIN_CITATION_RECALL", 0.6),
    refusalAccuracy: threshold("PORTFOLIO_EVAL_MIN_REFUSAL_ACCURACY", 1),
  };

  if (
    aggregate.outcome_accuracy < gates.outcomeAccuracy ||
    aggregate.retrieval_hit_rate < gates.retrievalHitRate ||
    aggregate.citation_precision < gates.citationPrecision ||
    aggregate.citation_recall < gates.citationRecall ||
    aggregate.refusal_accuracy < gates.refusalAccuracy
  ) {
    throw new Error(`Portfolio quality gate failed: ${JSON.stringify({ aggregate, gates })}`);
  }

  console.log("PORTFOLIO_EVAL_PASSED");
}

main().catch((error: unknown) => {
  console.error(
    `PORTFOLIO_EVAL_FAILED ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
