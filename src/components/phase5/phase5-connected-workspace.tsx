"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_KNOWLEDGE_BASE_ID } from "@/domain";
import { publicDemoWorkspaceData } from "@/components/phase5/demo-scenarios";
import type {
  KnowledgeWorkspaceData,
  WorkspaceConnectionMode,
} from "@/features/workspace/domain/workspace";

import { Phase75Workspace } from "../phase75/phase75-workspace";
import {
  deleteWorkspaceDocument,
  loadDocumentPreview,
  loadWorkspace,
  submitQaRun,
  submitDemoScenario,
  uploadWorkspaceDocument,
  WorkspaceApiError,
} from "./workspace-api";

// Processing includes parsing, chunking, embedding, and finalization. Keep
// syncing long enough for a cold serverless invocation and a slow embedding
// provider, while still stopping when a document is genuinely stuck.
const DOCUMENT_POLL_DELAYS_MS = [
  300,
  500,
  1_000,
  1_500,
  2_500,
  4_000,
  6_000,
  8_000,
  10_000,
  12_000,
  15_000,
  15_000,
] as const;

type WorkspaceRefreshResult =
  | { status: "success"; workspace: KnowledgeWorkspaceData }
  | { status: "failed" }
  | { status: "cancelled" };

function hasDocumentsAwaitingProcessing(workspace: KnowledgeWorkspaceData): boolean {
  return workspace.documents.some((document) =>
    document.status === "uploading" ||
    document.status === "uploaded" ||
    document.status === "processing",
  );
}

function refreshFailureMessage(error: unknown, hasLiveSnapshot: boolean): string {
  const detail =
    error instanceof Error
      ? error.message
      : "The live workspace is temporarily unavailable.";

  return hasLiveSnapshot
    ? `${detail} Showing the last synced live workspace snapshot (stale).`
    : `${detail} Showing the clearly labelled demo workspace.`;
}

function waitForPollDelay(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;

    const settle = (completed: boolean) => {
      if (settled) return;
      settled = true;

      window.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", handleAbort);
      resolve(completed);
    };
    const handleAbort = () => settle(false);
    const timeoutId = window.setTimeout(() => settle(true), delayMs);

    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

export function Phase5ConnectedWorkspace({
  publicDemo = false,
  userEmail,
  userName,
  onSignOut,
}: {
  publicDemo?: boolean;
  userEmail?: string;
  userName?: string;
  onSignOut?: () => void;
}) {
  const [data, setData] = useState<KnowledgeWorkspaceData | undefined>(publicDemo ? { ...publicDemoWorkspaceData, dataMode: "demo" } : undefined);
  const [mode, setMode] = useState<WorkspaceConnectionMode>("demo");
  const [message, setMessage] = useState(publicDemo
    ? "Fictional Asteria corpus and preset portfolio results."
    : "Connecting to the live knowledge workspace…");
  const [isLoading, setIsLoading] = useState(!publicDemo);
  const hasLiveSnapshotRef = useRef(false);
  const refreshRequestIdRef = useRef(0);
  const lifecycleControllerRef = useRef<AbortController | null>(null);
  const pollingDocumentsRef = useRef(false);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<WorkspaceRefreshResult> => {
    const requestId = ++refreshRequestIdRef.current;

    try {
      const workspace = await loadWorkspace(DEFAULT_KNOWLEDGE_BASE_ID, signal);

      if (signal?.aborted || requestId !== refreshRequestIdRef.current) {
        return { status: "cancelled" };
      }

      hasLiveSnapshotRef.current = true;
      setData(workspace);
      setMode(workspace.dataMode === "demo" || publicDemo ? "demo" : "live");
      setMessage(workspace.dataMode === "demo"
        ? "Fictional Asteria corpus and pre-verified portfolio scenarios."
        : "Live Supabase knowledge and QA traces are connected.");

      setIsLoading(false);
      return { status: "success", workspace };
    } catch (error) {
      if (signal?.aborted || requestId !== refreshRequestIdRef.current) {
        return { status: "cancelled" };
      }

      if (error instanceof WorkspaceApiError && error.status === 401) {
        onSignOut?.();
      }

      setMode("disconnected");
      setMessage(refreshFailureMessage(error, hasLiveSnapshotRef.current));
      setIsLoading(false);
      return { status: "failed" };
    }
  }, [onSignOut, publicDemo]);

  const pollUntilDocumentsSettle = useCallback(async (
    initialWorkspace: KnowledgeWorkspaceData,
    signal?: AbortSignal,
  ) => {
    if (pollingDocumentsRef.current) return;
    pollingDocumentsRef.current = true;
    let workspace = initialWorkspace;

    try {
      for (const delayMs of DOCUMENT_POLL_DELAYS_MS) {
        if (!hasDocumentsAwaitingProcessing(workspace)) return;
        if (!(await waitForPollDelay(delayMs, signal))) return;

        const result = await refresh(signal);
        if (result.status === "cancelled") {
          if (signal?.aborted) return;
          continue;
        }
        if (result.status === "success") workspace = result.workspace;
        // A transient refresh failure must not end the only polling loop. The
        // next backoff attempt can recover without leaving the UI stale.
      }
    } finally {
      pollingDocumentsRef.current = false;
    }
  }, [refresh]);

  useEffect(() => {
    if (publicDemo) return;
    const controller = new AbortController();
    lifecycleControllerRef.current = controller;
    const initialRefreshId = window.setTimeout(() => {
      void (async () => {
        const result = await refresh(controller.signal);
        if (result.status === "success" && hasDocumentsAwaitingProcessing(result.workspace)) {
          void pollUntilDocumentsSettle(result.workspace, controller.signal);
        }
      })();
    }, 0);

    return () => {
      window.clearTimeout(initialRefreshId);
      controller.abort();
      lifecycleControllerRef.current = null;
    };
  }, [publicDemo, pollUntilDocumentsSettle, refresh]);

  return (
    <Phase75Workspace
      data={data}
      userEmail={userEmail}
      userName={userName}
      onSignOut={onSignOut}
      connectionMode={mode}
      connectionMessage={message}
      isLoading={isLoading}
      onQuerySubmit={async (query) => {
        const answer = await submitQaRun(
          query,
          data?.knowledgeBaseId ?? DEFAULT_KNOWLEDGE_BASE_ID,
        );

        // Refresh errors are represented as a stale snapshot instead of
        // rejecting the successful QA request. Returning the answer lets the
        // shell keep the newly generated claim/evidence chain visible.
        await refresh(lifecycleControllerRef.current?.signal);
        return answer;
      }}
      onDemoScenario={submitDemoScenario}
      onDocumentPreview={async (document) => {
        const preview = await loadDocumentPreview(document.id);
        return { downloadUrl: preview.download_url, expiresAt: preview.expires_at };
      }}
      onDocumentDelete={async (document) => {
        await deleteWorkspaceDocument(document.id);
        await refresh(lifecycleControllerRef.current?.signal);
      }}
      onUpload={async (file) => {
        const uploadReceipt = await uploadWorkspaceDocument(
          file,
          data?.knowledgeBaseId ?? DEFAULT_KNOWLEDGE_BASE_ID,
        );
        const signal = lifecycleControllerRef.current?.signal;
        const result = await refresh(signal);

        if (
          result.status === "success" &&
          hasDocumentsAwaitingProcessing(result.workspace)
        ) {
          void pollUntilDocumentsSettle(result.workspace, signal);
        }

        return uploadReceipt;
      }}
    />
  );
}
