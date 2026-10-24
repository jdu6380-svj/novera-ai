export type WorkspaceDocumentStatus =
  | "uploading"
  | "uploaded"
  | "processing"
  | "ready"
  | "failed"
  | "deleting";

export type WorkspaceDocumentQuality = "complete" | "review_required" | "unavailable";

export interface WorkspaceDocumentWarning {
  code: string;
  message: string;
  severity?: "notice" | "review_required";
  location?: string;
  remediation?: string;
}

export interface WorkspaceDocument {
  id: string;
  name: string;
  type: "PDF" | "MD" | "TXT" | "DOCX" | "XLSX" | "PPTX" | "PNG" | "JPG";
  status: WorkspaceDocumentStatus;
  updatedAt: string;
  /** ISO timestamp for the upload event when the live workspace provides it. */
  uploadedAt?: string | null;
  /** ISO timestamp used as a fallback for records created before upload completion. */
  createdAt?: string | null;
  size: string;
  chunks: number;
  progress?: number;
  quality?: WorkspaceDocumentQuality;
  warnings?: WorkspaceDocumentWarning[];
  qaEligible?: boolean;
  qaEligibleChunkCount?: number;
  remediation?: string;
}

export type ClaimSupportStatus = "full" | "partial" | "unsupported" | "conflict";

export interface WorkspaceEvidence {
  id: string;
  citationLabel: string;
  quote: string;
  documentId: string;
  documentName: string;
  locator: string;
  section?: string;
  supportScore: number;
  relevanceScore: number;
}

export interface WorkspaceClaim {
  id: string;
  text: string;
  type: "fact" | "analysis" | "comparison" | "recommendation";
  supportStatus: ClaimSupportStatus;
  evidenceIds: string[];
}

export interface WorkspaceMetric {
  key: "retrieval" | "coverage" | "match" | "confidence";
  label: string;
  score: number;
  explanation: string;
}

export interface WorkspaceAnswer {
  query: string;
  taskType: "qa" | "summary" | "analysis" | "compare" | "recommend";
  answer: string;
  limitations: string[];
  insufficientEvidence: boolean;
  confidence: number;
  claims: WorkspaceClaim[];
  evidence: WorkspaceEvidence[];
  metrics: WorkspaceMetric[];
  runId: string;
  createdAt: string;
}

export type InsightType = "frequent" | "gap" | "low-confidence" | "unanswered";

export interface WorkspaceInsight {
  id: string;
  type: InsightType;
  label: string;
  question: string;
  count: number;
  score?: number;
  detail: string;
}

export interface WorkspaceQaRun {
  id: string;
  query: string;
  taskType: WorkspaceAnswer["taskType"];
  confidence: number;
  status: "completed" | "insufficient_evidence" | "failed";
  createdAt: string;
  sourceCount: number;
}

export interface KnowledgeWorkspaceData {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  knowledgeBaseDescription: string;
  healthScore: number;
  dataMode?: "demo" | "live";
  documents: WorkspaceDocument[];
  qaRuns: WorkspaceQaRun[];
  insights: WorkspaceInsight[];
  answer: WorkspaceAnswer;
}

export type WorkspaceConnectionMode = "live" | "demo" | "disconnected";

export interface WorkspaceSnapshot {
  mode: WorkspaceConnectionMode;
  data: KnowledgeWorkspaceData;
  message?: string;
}
