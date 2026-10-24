"use client";

import { useState } from "react";

import { getDemoScenario, publicDemoWorkspaceData } from "@/components/phase5/demo-scenarios";
import { Phase5Icon } from "@/components/phase5/icons";
import { Phase75Workspace } from "@/components/phase75/phase75-workspace";

/**
 * Public portfolio entry: the only data source is the repository's fixed demo
 * fixture, and every interactive scenario stays local to the client.
 */
export function PublicDemoWorkspace() {
  const [selectedDocumentId, setSelectedDocumentId] = useState(publicDemoWorkspaceData.documents[0]?.id ?? "");
  const selectedDocument = publicDemoWorkspaceData.documents.find(({ id }) => id === selectedDocumentId) ?? publicDemoWorkspaceData.documents[0];

  return (
    <>
      <section className="phase75-connection-banner" aria-label="预置文档选择">
        <Phase5Icon name="document" />
        <div>
          <strong>预置文档 · Fixture 数据</strong>
          <div className="phase75-suggestion-row">
            {publicDemoWorkspaceData.documents.map((document) => (
              <button
                key={document.id}
                type="button"
                aria-pressed={document.id === selectedDocument?.id}
                onClick={() => setSelectedDocumentId(document.id)}
              >
                {document.name}
              </button>
            ))}
          </div>
          {selectedDocument ? <span>当前选择：{selectedDocument.name} · {selectedDocument.size} · 仅展示固定元数据，不读取文档服务。</span> : null}
        </div>
      </section>
      <Phase75Workspace
        data={{ ...publicDemoWorkspaceData, dataMode: "demo" }}
        connectionMode="demo"
        userName="公开演示访客"
        onDemoScenario={async (id) => getDemoScenario(id)}
      />
    </>
  );
}
