import type {
  KnowledgeWorkspaceData,
  WorkspaceAnswer,
  WorkspaceConnectionMode,
  WorkspaceDocument,
} from "@/features/workspace/domain/workspace";

export interface DocumentUploadReceipt {
  documentId: string;
}

export type {
  ClaimSupportStatus,
  InsightType,
  KnowledgeWorkspaceData,
  WorkspaceAnswer,
  WorkspaceClaim,
  WorkspaceConnectionMode,
  WorkspaceDocument,
  WorkspaceDocumentStatus,
  WorkspaceEvidence,
  WorkspaceInsight,
  WorkspaceMetric,
  WorkspaceQaRun,
  WorkspaceSnapshot,
} from "@/features/workspace/domain/workspace";

export interface Phase5WorkspaceProps {
  /** Optional server/API snapshot. An empty private workspace never falls back to demo documents. */
  data?: Partial<KnowledgeWorkspaceData>;
  /** Called when a file is selected so the real upload flow can be connected later. */
  onUpload?: (file: File) =>
    | void
    | DocumentUploadReceipt
    | Promise<void | DocumentUploadReceipt>;
  /** Called when a question is submitted so the real QA route can be connected later. */
  onQuerySubmit?: (query: string) =>
    | void
    | Partial<WorkspaceAnswer>
    | Promise<void | Partial<WorkspaceAnswer>>;
  onDemoScenario?: (id: "cross-document-analysis" | "knowledge-gap-refusal") => Promise<WorkspaceAnswer>;
  connectionMode?: WorkspaceConnectionMode;
  connectionMessage?: string;
  isLoading?: boolean;
  userEmail?: string;
  userName?: string;
  onSignOut?: () => void;
  onDocumentPreview?: (document: WorkspaceDocument) => Promise<{
    downloadUrl: string;
    expiresAt: string;
  }>;
  onDocumentDelete?: (document: WorkspaceDocument) => Promise<void>;
}
