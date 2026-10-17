import type {
  DocumentProcessingJob,
  DocumentProcessingStage,
  DocumentStatus,
  EmbeddingVector,
  JsonObject,
  ProcessingJobStatus,
} from "@/domain";

export interface ProcessingDocumentRecord {
  id: string;
  knowledgeBaseId: string;
  displayName: string;
  originalFilename: string;
  mimeType: string;
  fileExtension: string;
  storageBucket: string;
  storagePath: string;
  fileSizeBytes: number;
  status: DocumentStatus;
  processingStage: DocumentProcessingStage | null;
  progressPct: number;
  metadata: JsonObject;
  parserName: string | null;
  parserVersion: string | null;
  pageCount: number | null;
  charCount: number | null;
  tokenCount: number | null;
  chunkCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  uploadedAt: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProcessingJobInput {
  documentId: string;
  idempotencyKey: string;
  maxAttempts: number;
  config: JsonObject;
}

export interface PersistedProcessingChunk {
  chunkIndex: number;
  text: string;
  textHash: string;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  startChar: number | null;
  endChar: number | null;
  sectionPath: string | null;
  metadata: JsonObject;
  embedding: EmbeddingVector;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingModelVersion: string;
  embeddingDimension: number;
  embeddedAt: string;
}

export interface CompleteProcessingJobInput {
  jobId: string;
  parserName: string;
  parserVersion: string;
  pageCount: number | null;
  charCount: number;
  tokenCount: number;
  processingMetadata: JsonObject;
  chunks: readonly PersistedProcessingChunk[];
  completedAt: string;
}

export interface FailProcessingJobInput {
  jobId: string;
  errorCode: string;
  errorMessage: string;
  failedAt: string;
}

export interface DocumentProcessingRepository {
  findDocument(documentId: string): Promise<ProcessingDocumentRecord | null>;
  findJob(jobId: string): Promise<DocumentProcessingJob | null>;
  findActiveJobForDocument(documentId: string): Promise<DocumentProcessingJob | null>;
  findLatestJobForDocument(documentId: string): Promise<DocumentProcessingJob | null>;
  createPendingJob(input: CreateProcessingJobInput): Promise<DocumentProcessingJob>;
  claimJob(jobId: string, startedAt: string): Promise<boolean>;
  updateProgress(
    jobId: string,
    stage: DocumentProcessingStage,
    progressPct: number,
  ): Promise<void>;
  completeJob(input: CompleteProcessingJobInput): Promise<void>;
  failJob(input: FailProcessingJobInput): Promise<void>;
  markRetry(jobId: string): Promise<DocumentProcessingJob>;
  requeueRetry(jobId: string): Promise<DocumentProcessingJob>;
}

export type DocumentProcessingRepositoryErrorCode =
  | "DOCUMENT_NOT_FOUND"
  | "JOB_NOT_FOUND"
  | "DUPLICATE_ACTIVE_JOB"
  | "INVALID_DOCUMENT_STATE"
  | "INVALID_JOB_STATE"
  | "MAX_ATTEMPTS_REACHED"
  | "WRITE_FAILED";

export class DocumentProcessingRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: DocumentProcessingRepositoryErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentProcessingRepositoryError";
  }
}

export function isActiveProcessingJobStatus(status: ProcessingJobStatus): boolean {
  return status === "pending" || status === "processing";
}
