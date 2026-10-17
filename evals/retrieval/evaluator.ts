export const RETRIEVAL_EVALUATION_SCHEMA_VERSION = "1.0" as const;

export const RETRIEVAL_TASK_TYPES = [
  "qa",
  "summary",
  "analysis",
  "compare",
  "recommend",
] as const;

export type RetrievalTaskType = (typeof RETRIEVAL_TASK_TYPES)[number];

export interface ExpectedDocumentReference {
  documentId?: string;
  documentName?: string;
}

export interface ExpectedChunkReference extends ExpectedDocumentReference {
  chunkId?: string;
  sectionPath?: string;
}

export interface GoldenRetrievalCase {
  id: string;
  question: string;
  taskType: RetrievalTaskType;
  topK: number;
  expectedDocuments: ExpectedDocumentReference[];
  expectedChunks: ExpectedChunkReference[];
  tags: string[];
}

export interface GoldenRetrievalDataset {
  schemaVersion: typeof RETRIEVAL_EVALUATION_SCHEMA_VERSION;
  datasetId: string;
  corpusId: string;
  description: string;
  createdAt: string;
  cases: GoldenRetrievalCase[];
}

export interface RetrievedChunkCandidate {
  chunkId: string;
  documentId: string;
  documentName?: string;
  similarityScore: number;
  sectionPath?: string | null;
  metadata?: Record<string, unknown>;
  locator?: Record<string, unknown>;
}

export interface RetrievalCaseResult {
  caseId: string;
  results: RetrievedChunkCandidate[];
}

export interface RetrievalEvaluationRun {
  schemaVersion: typeof RETRIEVAL_EVALUATION_SCHEMA_VERSION;
  datasetId: string;
  generatedAt: string;
  cases: RetrievalCaseResult[];
}

export interface RetrievalCaseMetrics {
  caseId: string;
  taskType: RetrievalTaskType;
  evaluatedAtK: number;
  hitRateAtK: number;
  recallAtK: number;
  reciprocalRank: number;
  documentRecallAtK: number;
  chunkRecallAtK: number;
  firstRelevantRank: number | null;
  matchedDocumentCount: number;
  expectedDocumentCount: number;
  matchedChunkCount: number;
  expectedChunkCount: number;
}

export interface RetrievalAggregateMetrics {
  caseCount: number;
  hitRateAtK: number;
  recallAtK: number;
  meanReciprocalRank: number;
  documentRecallAtK: number;
  chunkRecallAtK: number;
}

export interface RetrievalEvaluationReport {
  schemaVersion: typeof RETRIEVAL_EVALUATION_SCHEMA_VERSION;
  datasetId: string;
  corpusId: string;
  evaluatedAt: string;
  aggregate: RetrievalAggregateMetrics;
  cases: RetrievalCaseMetrics[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonBlankString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-blank string`);
  }

  return value.trim();
}

function optionalNonBlankString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return nonBlankString(value, path);
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${path} must be a positive integer`);
  }

  return Number(value);
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }

  return value;
}

function parseStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }

  return value.map((item, index) => nonBlankString(item, `${path}[${index}]`));
}

function parseExpectedDocument(
  value: unknown,
  path: string,
): ExpectedDocumentReference {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  const reference = {
    documentId: optionalNonBlankString(value.documentId, `${path}.documentId`),
    documentName: optionalNonBlankString(value.documentName, `${path}.documentName`),
  };

  if (!reference.documentId && !reference.documentName) {
    throw new Error(`${path} must include documentId or documentName`);
  }

  return reference;
}

function parseExpectedChunk(value: unknown, path: string): ExpectedChunkReference {
  const document = parseExpectedDocument(value, path);
  const row = value as Record<string, unknown>;
  const reference = {
    ...document,
    chunkId: optionalNonBlankString(row.chunkId, `${path}.chunkId`),
    sectionPath: optionalNonBlankString(row.sectionPath, `${path}.sectionPath`),
  };

  if (!reference.chunkId && !reference.sectionPath) {
    throw new Error(`${path} must include chunkId or sectionPath`);
  }

  return reference;
}

function parseExpectedArray<T>(
  value: unknown,
  path: string,
  parser: (item: unknown, itemPath: string) => T,
): T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array`);
  }

  return value.map((item, index) => parser(item, `${path}[${index}]`));
}

export function parseGoldenRetrievalDataset(value: unknown): GoldenRetrievalDataset {
  if (!isRecord(value)) {
    throw new Error("Golden retrieval dataset must be an object");
  }

  if (value.schemaVersion !== RETRIEVAL_EVALUATION_SCHEMA_VERSION) {
    throw new Error(
      `schemaVersion must be ${RETRIEVAL_EVALUATION_SCHEMA_VERSION}`,
    );
  }

  if (!Array.isArray(value.cases) || value.cases.length === 0) {
    throw new Error("cases must be a non-empty array");
  }

  const seenCaseIds = new Set<string>();
  const cases = value.cases.map((item, index): GoldenRetrievalCase => {
    const path = `cases[${index}]`;

    if (!isRecord(item)) {
      throw new Error(`${path} must be an object`);
    }

    const id = nonBlankString(item.id, `${path}.id`);

    if (seenCaseIds.has(id)) {
      throw new Error(`Duplicate golden case id: ${id}`);
    }

    seenCaseIds.add(id);

    if (
      typeof item.taskType !== "string" ||
      !RETRIEVAL_TASK_TYPES.includes(item.taskType as RetrievalTaskType)
    ) {
      throw new Error(`${path}.taskType is not supported`);
    }

    return {
      id,
      question: nonBlankString(item.question, `${path}.question`),
      taskType: item.taskType as RetrievalTaskType,
      topK: positiveInteger(item.topK, `${path}.topK`),
      expectedDocuments: parseExpectedArray(
        item.expectedDocuments,
        `${path}.expectedDocuments`,
        parseExpectedDocument,
      ),
      expectedChunks: parseExpectedArray(
        item.expectedChunks,
        `${path}.expectedChunks`,
        parseExpectedChunk,
      ),
      tags: parseStringArray(item.tags ?? [], `${path}.tags`),
    };
  });

  return {
    schemaVersion: RETRIEVAL_EVALUATION_SCHEMA_VERSION,
    datasetId: nonBlankString(value.datasetId, "datasetId"),
    corpusId: nonBlankString(value.corpusId, "corpusId"),
    description: nonBlankString(value.description, "description"),
    createdAt: nonBlankString(value.createdAt, "createdAt"),
    cases,
  };
}

export function parseRetrievalEvaluationRun(value: unknown): RetrievalEvaluationRun {
  if (!isRecord(value)) {
    throw new Error("Retrieval evaluation run must be an object");
  }

  if (value.schemaVersion !== RETRIEVAL_EVALUATION_SCHEMA_VERSION) {
    throw new Error(
      `schemaVersion must be ${RETRIEVAL_EVALUATION_SCHEMA_VERSION}`,
    );
  }

  if (!Array.isArray(value.cases)) {
    throw new Error("cases must be an array");
  }

  const seenCaseIds = new Set<string>();
  const cases = value.cases.map((item, caseIndex): RetrievalCaseResult => {
    const path = `cases[${caseIndex}]`;

    if (!isRecord(item)) {
      throw new Error(`${path} must be an object`);
    }

    const caseId = nonBlankString(item.caseId, `${path}.caseId`);

    if (seenCaseIds.has(caseId)) {
      throw new Error(`Duplicate retrieval result case id: ${caseId}`);
    }

    seenCaseIds.add(caseId);

    if (!Array.isArray(item.results)) {
      throw new Error(`${path}.results must be an array`);
    }

    const seenChunkIds = new Set<string>();
    const results = item.results.map((candidate, candidateIndex) => {
      const candidatePath = `${path}.results[${candidateIndex}]`;

      if (!isRecord(candidate)) {
        throw new Error(`${candidatePath} must be an object`);
      }

      const chunkId = nonBlankString(candidate.chunkId, `${candidatePath}.chunkId`);

      if (seenChunkIds.has(chunkId)) {
        throw new Error(`Duplicate chunk ${chunkId} in retrieval case ${caseId}`);
      }

      seenChunkIds.add(chunkId);

      return {
        chunkId,
        documentId: nonBlankString(
          candidate.documentId,
          `${candidatePath}.documentId`,
        ),
        documentName: optionalNonBlankString(
          candidate.documentName,
          `${candidatePath}.documentName`,
        ),
        similarityScore: finiteNumber(
          candidate.similarityScore,
          `${candidatePath}.similarityScore`,
        ),
        sectionPath:
          candidate.sectionPath === null
            ? null
            : optionalNonBlankString(
                candidate.sectionPath,
                `${candidatePath}.sectionPath`,
              ),
        metadata: isRecord(candidate.metadata) ? candidate.metadata : undefined,
        locator: isRecord(candidate.locator) ? candidate.locator : undefined,
      };
    });

    return { caseId, results };
  });

  return {
    schemaVersion: RETRIEVAL_EVALUATION_SCHEMA_VERSION,
    datasetId: nonBlankString(value.datasetId, "datasetId"),
    generatedAt: nonBlankString(value.generatedAt, "generatedAt"),
    cases,
  };
}

function normalizeIdentity(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return normalized || undefined;
}

function matchesDocument(
  expected: ExpectedDocumentReference,
  candidate: RetrievedChunkCandidate,
): boolean {
  const idMatches =
    expected.documentId !== undefined &&
    normalizeIdentity(expected.documentId) === normalizeIdentity(candidate.documentId);
  const nameMatches =
    expected.documentName !== undefined &&
    normalizeIdentity(expected.documentName) ===
      normalizeIdentity(candidate.documentName);

  return idMatches || nameMatches;
}

function matchesChunk(
  expected: ExpectedChunkReference,
  candidate: RetrievedChunkCandidate,
): boolean {
  if (
    expected.chunkId !== undefined &&
    normalizeIdentity(expected.chunkId) === normalizeIdentity(candidate.chunkId)
  ) {
    return true;
  }

  return (
    expected.sectionPath !== undefined &&
    normalizeIdentity(expected.sectionPath) ===
      normalizeIdentity(candidate.sectionPath) &&
    matchesDocument(expected, candidate)
  );
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function relevantToCase(
  goldenCase: GoldenRetrievalCase,
  candidate: RetrievedChunkCandidate,
): boolean {
  return (
    goldenCase.expectedChunks.some((expected) =>
      matchesChunk(expected, candidate),
    ) ||
    goldenCase.expectedDocuments.some((expected) =>
      matchesDocument(expected, candidate),
    )
  );
}

export function evaluateRetrieval(
  dataset: GoldenRetrievalDataset,
  run: RetrievalEvaluationRun,
  now: () => Date = () => new Date(),
): RetrievalEvaluationReport {
  if (run.datasetId !== dataset.datasetId) {
    throw new Error(
      `Evaluation run datasetId ${run.datasetId} does not match ${dataset.datasetId}`,
    );
  }

  const resultsByCase = new Map(run.cases.map((item) => [item.caseId, item.results]));
  const unknownCaseIds = run.cases
    .map((item) => item.caseId)
    .filter((caseId) => !dataset.cases.some((item) => item.id === caseId));

  if (unknownCaseIds.length > 0) {
    throw new Error(`Evaluation run contains unknown cases: ${unknownCaseIds.join(", ")}`);
  }

  const cases = dataset.cases.map((goldenCase): RetrievalCaseMetrics => {
    const retrieved = (resultsByCase.get(goldenCase.id) ?? []).slice(0, goldenCase.topK);
    const matchedDocumentCount = goldenCase.expectedDocuments.filter((expected) =>
      retrieved.some((candidate) => matchesDocument(expected, candidate)),
    ).length;
    const matchedChunkCount = goldenCase.expectedChunks.filter((expected) =>
      retrieved.some((candidate) => matchesChunk(expected, candidate)),
    ).length;
    const firstRelevantIndex = retrieved.findIndex((candidate) =>
      relevantToCase(goldenCase, candidate),
    );
    const firstRelevantRank = firstRelevantIndex < 0 ? null : firstRelevantIndex + 1;
    const documentRecallAtK = ratio(
      matchedDocumentCount,
      goldenCase.expectedDocuments.length,
    );
    const chunkRecallAtK = ratio(
      matchedChunkCount,
      goldenCase.expectedChunks.length,
    );

    return {
      caseId: goldenCase.id,
      taskType: goldenCase.taskType,
      evaluatedAtK: goldenCase.topK,
      hitRateAtK: firstRelevantRank === null ? 0 : 1,
      recallAtK: roundMetric(chunkRecallAtK),
      reciprocalRank:
        firstRelevantRank === null ? 0 : roundMetric(1 / firstRelevantRank),
      documentRecallAtK: roundMetric(documentRecallAtK),
      chunkRecallAtK: roundMetric(chunkRecallAtK),
      firstRelevantRank,
      matchedDocumentCount,
      expectedDocumentCount: goldenCase.expectedDocuments.length,
      matchedChunkCount,
      expectedChunkCount: goldenCase.expectedChunks.length,
    };
  });

  return {
    schemaVersion: RETRIEVAL_EVALUATION_SCHEMA_VERSION,
    datasetId: dataset.datasetId,
    corpusId: dataset.corpusId,
    evaluatedAt: now().toISOString(),
    aggregate: {
      caseCount: cases.length,
      hitRateAtK: roundMetric(average(cases.map((item) => item.hitRateAtK))),
      recallAtK: roundMetric(average(cases.map((item) => item.recallAtK))),
      meanReciprocalRank: roundMetric(
        average(cases.map((item) => item.reciprocalRank)),
      ),
      documentRecallAtK: roundMetric(
        average(cases.map((item) => item.documentRecallAtK)),
      ),
      chunkRecallAtK: roundMetric(
        average(cases.map((item) => item.chunkRecallAtK)),
      ),
    },
    cases,
  };
}
