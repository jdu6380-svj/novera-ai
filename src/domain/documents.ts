import type {
  ISODateTime,
  JsonObject,
  UUID,
} from "./primitives";

export const DOCUMENT_STATUSES = [
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "failed",
  "deleting",
  "deleted",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * Canonical document lifecycle. API/application services must validate writes
 * against this map instead of maintaining local status lists.
 */
export const DOCUMENT_STATUS_TRANSITIONS = {
  uploading: ["uploaded", "failed", "deleting"],
  uploaded: ["processing", "failed", "deleting"],
  processing: ["ready", "failed", "deleting"],
  ready: ["processing", "deleting"],
  failed: ["uploading", "processing", "deleting"],
  deleting: ["deleted", "failed"],
  deleted: [],
} as const satisfies Record<DocumentStatus, readonly DocumentStatus[]>;

export function canTransitionDocumentStatus(
  from: DocumentStatus,
  to: DocumentStatus,
): boolean {
  if (from === to) {
    return true;
  }

  return (DOCUMENT_STATUS_TRANSITIONS[from] as readonly DocumentStatus[]).includes(to);
}

export const DOCUMENT_PROCESSING_STAGES = [
  "upload",
  "parse",
  "chunk",
  "embed",
  "finalize",
] as const;

export type DocumentProcessingStage =
  (typeof DOCUMENT_PROCESSING_STAGES)[number];

export const PROCESSING_JOB_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "retry",
] as const;

export type ProcessingJobStatus =
  (typeof PROCESSING_JOB_STATUSES)[number];

export const PROCESSING_JOB_STATUS_TRANSITIONS = {
  pending: ["processing"],
  processing: ["completed", "failed"],
  completed: [],
  failed: ["retry"],
  retry: ["pending"],
} as const satisfies Record<ProcessingJobStatus, readonly ProcessingJobStatus[]>;

export function canTransitionProcessingJobStatus(
  from: ProcessingJobStatus,
  to: ProcessingJobStatus,
): boolean {
  if (from === to) {
    return true;
  }

  return (
    PROCESSING_JOB_STATUS_TRANSITIONS[from] as readonly ProcessingJobStatus[]
  ).includes(to);
}

export const EMBEDDING_STATUSES = ["pending", "ready", "failed"] as const;

export type EmbeddingStatus = (typeof EMBEDDING_STATUSES)[number];

export interface Document {
  id: UUID;
  knowledgeBaseId: UUID;
  displayName: string;
  originalFilename: string;
  mimeType: string;
  fileExtension: string;
  storageBucket: string;
  storagePath: string;
  fileSizeBytes: number;
  sha256: string | null;
  versionNo: number;
  status: DocumentStatus;
  processingStage: DocumentProcessingStage | null;
  progressPct: number;
  parserName: string | null;
  parserVersion: string | null;
  pageCount: number | null;
  charCount: number | null;
  tokenCount: number | null;
  chunkCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: JsonObject;
  uploadedAt: ISODateTime | null;
  processedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt: ISODateTime | null;
}

export interface CreateDocumentInput {
  knowledgeBaseId: UUID;
  displayName: string;
  originalFilename: string;
  mimeType: string;
  fileExtension: string;
  storageBucket: string;
  storagePath: string;
  fileSizeBytes: number;
  sha256?: string | null;
  metadata?: JsonObject;
}

export interface DocumentProcessingJob {
  id: UUID;
  documentId: UUID;
  stage: DocumentProcessingStage;
  status: ProcessingJobStatus;
  attempt: number;
  maxAttempts: number;
  progressPct: number;
  idempotencyKey: string | null;
  config: JsonObject;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: ISODateTime | null;
  finishedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface DocumentChunkLocator {
  pageStart: number | null;
  pageEnd: number | null;
  startChar: number | null;
  endChar: number | null;
  sectionPath: string | null;
}

export interface DocumentChunk extends DocumentChunkLocator {
  id: UUID;
  documentId: UUID;
  chunkIndex: number;
  text: string;
  textHash: string;
  tokenCount: number;
  metadata: JsonObject;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingModelVersion: string | null;
  embeddingDimension: number | null;
  embeddingStatus: EmbeddingStatus;
  embeddingError: string | null;
  embeddedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type EmbeddingVector = readonly number[];
