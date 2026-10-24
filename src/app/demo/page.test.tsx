import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getDemoScenario } from "@/components/phase5/demo-scenarios";

import DemoPage from "./page";

describe("public static demo entry", () => {
  it("renders the fixture-only workspace without live operations", () => {
    const markup = renderToStaticMarkup(<DemoPage />);

    expect(markup).toContain("演示数据");
    expect(markup).toContain("公开演示只读");
    expect(markup).toContain("预置回答场景");
    expect(markup).toContain('aria-label="预置文档选择"');
    expect(markup).toContain("当前选择：01-q2-retention-review.md");
    expect(markup).toContain("不调用实时模型或共享数据库");
    expect(markup).not.toContain("上传知识");
    expect(markup).not.toContain('type="file"');
    expect(markup).not.toContain("输入一个需要企业知识支持的问题");
  });

  it("keeps both preset scenarios backed by fixed answers and evidence", () => {
    const analysis = getDemoScenario("cross-document-analysis");
    const refusal = getDemoScenario("knowledge-gap-refusal");

    expect(analysis.runId).toBe("demo-cross-document-analysis");
    expect(analysis.evidence.length).toBeGreaterThan(0);
    expect(analysis.evidence[0]?.citationLabel).toBe("[S1]");
    expect(analysis.evidence[0]?.documentId).toBeTruthy();
    expect(refusal.runId).toBe("demo-knowledge-gap-refusal");
    expect(refusal.insufficientEvidence).toBe(true);
    expect(refusal.limitations.length).toBeGreaterThan(0);
    expect(refusal.evidence).toHaveLength(0);
  });
});
