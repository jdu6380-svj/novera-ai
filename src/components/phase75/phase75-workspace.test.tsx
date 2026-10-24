import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { demoWorkspaceData } from "@/components/phase5/demo-data";
import { publicDemoWorkspaceData } from "@/components/phase5/demo-scenarios";

import { EVIDENCE_SOURCE_ACTION_LABEL, isDuplicateUploadError, matchesUploadDocument, Phase75Workspace, sameDocumentName } from "./phase75-workspace";

describe("Phase 7.5 product experience", () => {
  it("renders the three Chinese-first product destinations", () => {
    const markup = renderToStaticMarkup(<Phase75Workspace />);

    expect(markup).toContain("首页");
    expect(markup).toContain("AI 助手");
    expect(markup).toContain("证据来源");
    expect(markup).toContain("上传知识");
  });

  it("shows the signed-in email in the top bar and sidebar account area", () => {
    const email = "account-two@example.com";
    const markup = renderToStaticMarkup(
      <Phase75Workspace userEmail={email} userName="账号二" />,
    );

    expect(markup).toContain("当前账号");
    expect(markup.match(new RegExp(email, "g"))).toHaveLength(5);
    expect(markup).toContain("phase75-topbar-email");
    expect(markup).toContain("phase75-sidebar-email");
  });

  it("shows ready documents with parser notices as QA-eligible but visibly qualified", () => {
    const document = {
      ...demoWorkspaceData.documents[0]!,
      status: "ready" as const,
      quality: "complete" as const,
      qaEligible: true,
      warnings: [{
        code: "XLSX_MERGED_CELLS_PRESENT",
        severity: "notice" as const,
        message: "Merged cell labels should be checked.",
        location: "Sheet Revenue",
        remediation: "Check the merged labels.",
      }],
    };
    const markup = renderToStaticMarkup(
      <Phase75Workspace
        data={{ ...demoWorkspaceData, documents: [document] }}
        connectionMode="live"
        isLoading={false}
      />,
    );

    expect(markup).toContain("可问答 · 有提示");
    expect(markup).toContain("phase75-document-status-good");
    expect(markup).toContain("Sheet Revenue: Merged cell labels should be checked.");
  });

  it("places sign out inside the top-right account menu", () => {
    const markup = renderToStaticMarkup(
      <Phase75Workspace userEmail="account@example.com" onSignOut={() => undefined} />,
    );

    expect(markup).toContain('aria-label="打开账号菜单"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain("退出账号");
    expect(markup).not.toContain("phase75-signout-button");
  });

  it("does not expose a verified badge before the answer page is opened", () => {
    const markup = renderToStaticMarkup(
      <Phase75Workspace
        data={{
          ...demoWorkspaceData,
          answer: {
            ...demoWorkspaceData.answer,
            insufficientEvidence: true,
            claims: [{ ...demoWorkspaceData.answer.claims[0]!, supportStatus: "unsupported", evidenceIds: [] }],
            evidence: [],
          },
        }}
      />,
    );

    expect(markup).not.toContain("已通过证据核验");
  });

  it("labels live source actions as evidence previews", () => {
    expect(EVIDENCE_SOURCE_ACTION_LABEL).toBe("查看证据片段");
    expect(EVIDENCE_SOURCE_ACTION_LABEL).not.toBe("查看原文定位");
  });

  it("keeps public demo read-only and labels preset scenarios", () => {
    const markup = renderToStaticMarkup(
      <Phase75Workspace
        data={{ ...publicDemoWorkspaceData, dataMode: "demo" }}
        connectionMode="demo"
        isLoading={false}
      />,
    );

    expect(markup).toContain("预置回答场景");
    expect(markup).toContain("演示数据");
    expect(markup).toContain("公开演示只读");
    expect(markup).not.toContain("上传知识");
    expect(markup).not.toContain('type="file"');
    expect(markup).not.toContain("输入一个需要企业知识支持的问题");
  });

  it("matches the workspace display name to the uploaded filename", () => {
    expect(sameDocumentName("novera-demo-knowledge-sales-20261005", "novera-demo-knowledge-sales-20261005.md")).toBe(true);
    expect(sameDocumentName("docs/novera-demo-knowledge-sales-20261005", "docs\\novera-demo-knowledge-sales-20261005.md")).toBe(true);
    expect(sameDocumentName("novera-demo-knowledge-sales-20261005", "another-document.md")).toBe(false);
  });

  it("prefers the upload document id when names are duplicated", () => {
    expect(matchesUploadDocument(
      { id: "new-document", name: "team-guide" },
      { documentId: "new-document", name: "team-guide.md" },
    )).toBe(true);
    expect(matchesUploadDocument(
      { id: "old-document", name: "team-guide" },
      { documentId: "new-document", name: "team-guide.md" },
    )).toBe(false);
  });

  it("keeps duplicate uploads distinct from processing failures", () => {
    expect(isDuplicateUploadError({ code: "DUPLICATE_DOCUMENT" })).toBe(true);
    expect(isDuplicateUploadError({ code: "STORAGE_UPLOAD_FAILED" })).toBe(false);
  });
});
