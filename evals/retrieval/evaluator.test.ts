import { describe, expect, it } from "vitest";

import deterministicResults from "./deterministic-results.v1.json";
import goldenDataset from "./golden-dataset.v1.json";
import {
  RETRIEVAL_TASK_TYPES,
  evaluateRetrieval,
  parseGoldenRetrievalDataset,
  parseRetrievalEvaluationRun,
  type RetrievalEvaluationRun,
} from "./evaluator";

describe("retrieval evaluator", () => {
  it("loads a versioned golden dataset covering all supported task types", () => {
    const dataset = parseGoldenRetrievalDataset(goldenDataset);

    expect(dataset.cases).toHaveLength(5);
    expect(new Set(dataset.cases.map((item) => item.taskType))).toEqual(
      new Set(RETRIEVAL_TASK_TYPES),
    );
    expect(
      dataset.cases.every(
        (item) =>
          item.question.length > 0 &&
          item.expectedDocuments.length > 0 &&
          item.expectedChunks.length > 0,
      ),
    ).toBe(true);
  });

  it("scores the deterministic baseline with perfect recall", () => {
    const dataset = parseGoldenRetrievalDataset(goldenDataset);
    const run = parseRetrievalEvaluationRun(deterministicResults);
    const report = evaluateRetrieval(
      dataset,
      run,
      () => new Date("2026-08-03T08:00:00.000Z"),
    );

    expect(report.evaluatedAt).toBe("2026-08-03T08:00:00.000Z");
    expect(report.aggregate).toEqual({
      caseCount: 5,
      hitRateAtK: 1,
      recallAtK: 1,
      meanReciprocalRank: 1,
      documentRecallAtK: 1,
      chunkRecallAtK: 1,
    });
  });

  it("calculates recall and reciprocal rank from the bounded top-k list", () => {
    const fullDataset = parseGoldenRetrievalDataset(goldenDataset);
    const summaryCase = fullDataset.cases.find(
      (item) => item.id === "summary-q2-retention",
    );

    expect(summaryCase).toBeDefined();

    const dataset = {
      ...fullDataset,
      cases: [{ ...summaryCase!, topK: 2 }],
    };
    const run: RetrievalEvaluationRun = {
      schemaVersion: "1.0",
      datasetId: dataset.datasetId,
      generatedAt: "2026-08-03T08:00:00.000Z",
      cases: [
        {
          caseId: "summary-q2-retention",
          results: [
            {
              chunkId: "irrelevant-chunk",
              documentId: "irrelevant-document",
              documentName: "无关文档",
              similarityScore: 0.99,
              sectionPath: "1. 无关章节",
            },
            {
              chunkId: "fixture-chunk-retention-drivers",
              documentId: "fixture-doc-retention-q2",
              documentName: "Q2 用户留存分析报告",
              similarityScore: 0.8,
              sectionPath: "3. 流失驱动因素 > 新用户激活",
            },
            {
              chunkId: "fixture-chunk-retention-executive-summary",
              documentId: "fixture-doc-retention-q2",
              documentName: "Q2 用户留存分析报告",
              similarityScore: 0.79,
              sectionPath: "1. 执行摘要",
            },
          ],
        },
      ],
    };

    const report = evaluateRetrieval(dataset, run);

    expect(report.cases[0]).toMatchObject({
      hitRateAtK: 1,
      recallAtK: 0.5,
      reciprocalRank: 0.5,
      documentRecallAtK: 1,
      chunkRecallAtK: 0.5,
      firstRelevantRank: 2,
      matchedChunkCount: 1,
      expectedChunkCount: 2,
    });
  });

  it("treats a missing case result as a zero-recall retrieval", () => {
    const fullDataset = parseGoldenRetrievalDataset(goldenDataset);
    const dataset = { ...fullDataset, cases: [fullDataset.cases[0]] };
    const run: RetrievalEvaluationRun = {
      schemaVersion: "1.0",
      datasetId: dataset.datasetId,
      generatedAt: "2026-08-03T08:00:00.000Z",
      cases: [],
    };

    const report = evaluateRetrieval(dataset, run);

    expect(report.aggregate).toMatchObject({
      hitRateAtK: 0,
      recallAtK: 0,
      meanReciprocalRank: 0,
      documentRecallAtK: 0,
      chunkRecallAtK: 0,
    });
  });

  it("rejects duplicate result chunks so ranking metrics stay deterministic", () => {
    expect(() =>
      parseRetrievalEvaluationRun({
        schemaVersion: "1.0",
        datasetId: "novera-retrieval-golden-v1",
        generatedAt: "2026-08-03T08:00:00.000Z",
        cases: [
          {
            caseId: "qa-cancellation-reason",
            results: [
              {
                chunkId: "duplicate",
                documentId: "document-a",
                similarityScore: 0.9,
              },
              {
                chunkId: "duplicate",
                documentId: "document-a",
                similarityScore: 0.8,
              },
            ],
          },
        ],
      }),
    ).toThrow("Duplicate chunk duplicate");
  });
});
