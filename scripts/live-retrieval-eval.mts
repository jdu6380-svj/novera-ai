import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  evaluateRetrieval,
  parseGoldenRetrievalDataset,
  parseRetrievalEvaluationRun,
  RETRIEVAL_EVALUATION_SCHEMA_VERSION,
  type RetrievedChunkCandidate,
} from "../evals/retrieval/evaluator.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  value: unknown,
  path: string,
  allowMissing = false,
): string | undefined {
  if (allowMissing && value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-blank string.`);
  }

  return value;
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }

  return value;
}

function candidateFrom(value: unknown, path: string): RetrievedChunkCandidate {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }

  const locator = isRecord(value.locator) ? value.locator : undefined;

  return {
    chunkId: requireString(value.chunk_id, `${path}.chunk_id`)!,
    documentId: requireString(value.document_id, `${path}.document_id`)!,
    documentName: requireString(value.document_name, `${path}.document_name`, true),
    similarityScore: requireNumber(
      value.similarity_score,
      `${path}.similarity_score`,
    ),
    sectionPath:
      locator?.section_path === null
        ? null
        : requireString(
            locator?.section_path,
            `${path}.locator.section_path`,
            true,
          ),
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
    locator,
  };
}

function threshold(name: string, fallback: number): number {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1.`);
  }

  return value;
}

async function main(): Promise<void> {
  const baseUrl = process.env.RETRIEVAL_EVAL_API_URL?.trim();

  if (!baseUrl) {
    console.error(
      "LIVE_RETRIEVAL_EVAL_SKIPPED missing RETRIEVAL_EVAL_API_URL (for example http://127.0.0.1:3000).",
    );
    process.exitCode = 2;
    return;
  }

  const datasetPath = resolve(
    process.cwd(),
    process.argv[2] ?? "evals/retrieval/golden-dataset.v1.json",
  );
  const dataset = parseGoldenRetrievalDataset(
    JSON.parse(await readFile(datasetPath, "utf8")) as unknown,
  );
  const knowledgeBaseId =
    process.env.DEFAULT_KNOWLEDGE_BASE_ID?.trim() ||
    "00000000-0000-4000-8000-000000000001";
  const endpoint = new URL("/api/v1/retrieval/query", baseUrl);
  const bearerToken = process.env.RETRIEVAL_EVAL_BEARER_TOKEN?.trim();
  const cases = [];

  for (const goldenCase of dataset.cases) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
      },
      body: JSON.stringify({
        query: goldenCase.question,
        knowledge_base_id: knowledgeBaseId,
        task_type: goldenCase.taskType,
        top_k: goldenCase.topK,
      }),
    });
    const body = (await response.json()) as unknown;

    if (!response.ok) {
      throw new Error(
        `Retrieval API returned HTTP ${response.status} for ${goldenCase.id}.`,
      );
    }

    if (!isRecord(body) || !isRecord(body.retrieval) || !Array.isArray(body.retrieval.chunks)) {
      throw new Error(`Retrieval API returned an invalid payload for ${goldenCase.id}.`);
    }

    cases.push({
      caseId: goldenCase.id,
      results: body.retrieval.chunks.map((item, index) =>
        candidateFrom(item, `${goldenCase.id}.chunks[${index}]`),
      ),
    });
  }

  const run = parseRetrievalEvaluationRun({
    schemaVersion: RETRIEVAL_EVALUATION_SCHEMA_VERSION,
    datasetId: dataset.datasetId,
    generatedAt: new Date().toISOString(),
    cases,
  });
  const report = evaluateRetrieval(dataset, run);

  console.log(JSON.stringify(report, null, 2));

  const minimumHitRate = threshold("RETRIEVAL_EVAL_MIN_HIT_RATE", 0.8);
  const minimumChunkRecall = threshold("RETRIEVAL_EVAL_MIN_CHUNK_RECALL", 0.7);

  if (
    report.aggregate.hitRateAtK < minimumHitRate ||
    report.aggregate.chunkRecallAtK < minimumChunkRecall
  ) {
    throw new Error(
      `Live retrieval quality gate failed: hitRateAtK=${report.aggregate.hitRateAtK}, chunkRecallAtK=${report.aggregate.chunkRecallAtK}.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(
    `LIVE_RETRIEVAL_EVAL_FAILED ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
