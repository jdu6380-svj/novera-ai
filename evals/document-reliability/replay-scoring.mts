import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { evaluateCaseResult, type EvaluationExpectation } from "./scoring.ts";

const root = path.resolve(process.cwd(), "evals/document-reliability");
const sourceFileName = process.argv[2] ?? "2026-10-23T16-15-05-495Z-full.json";

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const [sourceBytes, manifestBytes, specBytes, scoringBytes] = await Promise.all([
  readFile(path.join(root, "runs", sourceFileName)),
  readFile(path.join(root, "manifest.v1.json")),
  readFile(path.join(root, "corpus-spec.v1.json")),
  readFile(path.join(root, "scoring.ts")),
]);
const sourceRun = JSON.parse(sourceBytes.toString("utf8")) as Record<string, unknown>;
const manifest = JSON.parse(manifestBytes.toString("utf8")) as { cases: EvaluationExpectation[] };
const expectations = new Map(manifest.cases.map((item) => [item.case_id, item]));
const sourceCases = Array.isArray(sourceRun.cases) ? sourceRun.cases.map(record) : [];
const cases = sourceCases.map((result) => {
  const caseId = String(result.case_id ?? "");
  const expected = expectations.get(caseId);
  const evaluation = !expected || result.status !== "EXECUTED"
    ? { status: "UNVERIFIED", criterion: "real_generation_not_executed" }
    : evaluateCaseResult(result, expected);
  return { ...result, evaluation };
});
const counts = {
  total: cases.length,
  pass: cases.filter((item) => record(item.evaluation).status === "PASS").length,
  fail: cases.filter((item) => record(item.evaluation).status === "FAIL").length,
  unverified: cases.filter((item) => record(item.evaluation).status === "UNVERIFIED").length,
};
const generatedAt = new Date().toISOString();
const fileName = `${generatedAt.replace(/[:.]/gu, "-")}-scoring-replay.json`;
const outputPath = path.join(root, "runs", fileName);
const artifact = {
  schema_version: "1.0.0",
  mode: "offline-scoring-replay",
  generated_at: generatedAt,
  scoring_version: "answerability-aware-v1",
  source_run: {
    file: sourceFileName,
    sha256: sha256(sourceBytes),
    mode: sourceRun.mode,
    generated_at: sourceRun.generated_at,
  },
  fixed_inputs: {
    manifest_sha256: sha256(manifestBytes),
    corpus_spec_sha256: sha256(specBytes),
  },
  scoring_code_sha256: sha256(scoringBytes),
  execution_boundary: "Offline re-evaluation only. No model endpoint, embedding provider, vector index, database, or Storage was accessed.",
  aggregate: {
    ...counts,
    status: counts.pass === counts.total ? "PASS" : "PARTIAL",
  },
  cases,
};

await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ artifact_path: outputPath, aggregate: artifact.aggregate }, null, 2)}\n`);
