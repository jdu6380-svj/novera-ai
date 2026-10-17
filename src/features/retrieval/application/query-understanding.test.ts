import { describe, expect, it } from "vitest";

import {
  QueryUnderstandingError,
  QueryUnderstandingLayer,
  normalizeUserQuery,
} from "./query-understanding";

const layer = new QueryUnderstandingLayer();

describe("QueryUnderstandingLayer", () => {
  it.each([
    ["What is the current refund policy?", "qa"],
    ["Summarize the onboarding research and list the key takeaways.", "summary"],
    ["分析为什么最近用户流失增加？", "analysis"],
    ["Compare the enterprise and starter plans.", "compare"],
    ["你建议我们下一步如何改进激活流程？", "recommend"],
  ] as const)("classifies %s as %s", (query, expectedTaskType) => {
    const result = layer.understand({ query });

    expect(result.understoodTaskType).toBe(expectedTaskType);
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
    expect(result.details.classifier).toBe("novera-task-understanding-rules");
  });

  it("normalizes Unicode width and whitespace without discarding source wording", () => {
    expect(normalizeUserQuery("  分析\u3000Ｎｏｖｅｒａ   流失原因？\n"))
      .toBe("分析 Novera 流失原因?");
  });

  it("returns explainable signals and per-intent scores", () => {
    const result = layer.understand({
      query: "Compare activation trends and recommend next steps.",
    });

    expect(result.understoodTaskType).toBe("recommend");
    expect(result.signals.map((signal) => signal.id)).toEqual(
      expect.arrayContaining([
        "compare-explicit",
        "recommend-explicit",
        "recommend-action",
        "analysis-pattern",
      ]),
    );
    expect(result.details.mode).toBe("rules");
    expect(result.details.intent_scores).toMatchObject({
      compare: 4,
      recommend: 7.4,
    });
  });

  it("honors an explicit requested task type instead of reclassifying it", () => {
    const result = layer.understand({
      query: "Why is churn increasing?",
      requestedTaskType: "summary",
    });

    expect(result.requestedTaskType).toBe("summary");
    expect(result.understoodTaskType).toBe("summary");
    expect(result.confidence).toBe(1);
    expect(result.signals).toEqual([
      {
        id: "requested-task-type",
        taskType: "summary",
        matchedText: "summary",
        weight: 1,
      },
    ]);
    expect(result.details.mode).toBe("explicit");
  });

  it("falls back to qa with a conservative confidence when no rule matches", () => {
    const result = layer.understand({ query: "Refund policy" });

    expect(result.understoodTaskType).toBe("qa");
    expect(result.confidence).toBe(0.55);
    expect(result.signals).toEqual([]);
    expect(result.details.mode).toBe("fallback");
  });

  it("is deterministic for ambiguous multi-intent input", () => {
    const input = { query: "分析并比较两个版本的差异，然后建议下一步。" };
    const first = layer.understand(input);
    const second = layer.understand(input);

    expect(second).toEqual(first);
    expect(first.understoodTaskType).toBe("compare");
    expect(first.confidence).toBeLessThan(0.98);
  });

  it("rejects an empty normalized query", () => {
    expect(() => layer.understand({ query: " \n\t　" })).toThrowError(
      expect.objectContaining({
        name: "QueryUnderstandingError",
        code: "EMPTY_QUERY",
      } satisfies Partial<QueryUnderstandingError>),
    );
  });
});
