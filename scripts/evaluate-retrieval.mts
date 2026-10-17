import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  evaluateRetrieval,
  parseGoldenRetrievalDataset,
  parseRetrievalEvaluationRun,
} from "../evals/retrieval/evaluator.ts";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

const [datasetArgument, runArgument] = process.argv.slice(2);
const datasetPath = resolve(
  process.cwd(),
  datasetArgument ?? "evals/retrieval/golden-dataset.v1.json",
);
const runPath = resolve(
  process.cwd(),
  runArgument ?? "evals/retrieval/deterministic-results.v1.json",
);

const dataset = parseGoldenRetrievalDataset(await readJson(datasetPath));
const run = parseRetrievalEvaluationRun(await readJson(runPath));
const report = evaluateRetrieval(dataset, run);

console.log(JSON.stringify(report, null, 2));
