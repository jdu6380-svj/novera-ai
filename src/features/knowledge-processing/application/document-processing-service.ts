import {
  EMBEDDING_DIMENSION,
  type DocumentProcessingJob,
  type JsonObject,
} from "@/domain";
import {
  DocumentChunkingError,
  StructuredDocumentChunker,
  estimateTokenCount,
  type KnowledgeChunk,
} from "@/features/knowledge-processing/content/chunker";
import { NormalizerLayer } from "@/features/knowledge-processing/content/normalizer";
import {
  DocumentParsingError,
  ParserLayer,
} from "@/features/knowledge-processing/content/parser";
import {
  extractionWarningRemediation,
  reviewRequiredExtractionWarnings,
  reviewWarningsForSources,
} from "@/features/knowledge-processing/content/extraction-warnings";
import { EmbeddingProviderError } from "@/infrastructure/ai";
import type { StorageAdapter } from "@/infrastructure/storage/storage-adapter";
import { StorageError } from "@/infrastructure/storage/storage-error";
import type { EmbeddingProvider } from "@/providers";

import type { DocumentProcessingConfig } from "./document-processing-config";
import { DocumentProcessingError } from "./document-processing-error";
import {
  DocumentProcessingRepositoryError,
  type DocumentProcessingRepository,
  type PersistedProcessingChunk,
  type ProcessingDocumentRecord,
} from "./document-processing-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface EnqueueDocumentProcessingResult {
  document: ProcessingDocumentRecord;
  job: DocumentProcessingJob;
  idempotent: boolean;
}

export interface RunDocumentProcessingResult {
  document: ProcessingDocumentRecord;
  job: DocumentProcessingJob;
  executed: boolean;
}

export interface RetryDocumentProcessingResult {
  document: ProcessingDocumentRecord;
  job: DocumentProcessingJob;
  idempotent: boolean;
}

interface ProcessingFailure {
  code: string;
  message: string;
  error: DocumentProcessingError;
}

function validateId(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new DocumentProcessingError(
      `${label} is invalid.`,
      "INVALID_REQUEST",
      400,
    );
  }
}

function mapRepositoryError(error: unknown): DocumentProcessingError {
  if (error instanceof DocumentProcessingError) {
    return error;
  }

  if (error instanceof DocumentProcessingRepositoryError) {
    switch (error.code) {
      case "DOCUMENT_NOT_FOUND":
        return new DocumentProcessingError(
          "The source document was not found.",
          "DOCUMENT_NOT_FOUND",
          404,
          undefined,
          { cause: error },
        );
      case "JOB_NOT_FOUND":
        return new DocumentProcessingError(
          "The processing job was not found.",
          "JOB_NOT_FOUND",
          404,
          undefined,
          { cause: error },
        );
      case "INVALID_DOCUMENT_STATE":
        return new DocumentProcessingError(
          "The document cannot be processed from its current state.",
          "INVALID_DOCUMENT_STATE",
          409,
          undefined,
          { cause: error },
        );
      case "INVALID_JOB_STATE":
        return new DocumentProcessingError(
          "The processing job cannot transition from its current state.",
          "INVALID_JOB_STATE",
          409,
          undefined,
          { cause: error },
        );
      case "MAX_ATTEMPTS_REACHED":
        return new DocumentProcessingError(
          "The processing job has reached its retry limit.",
          "MAX_ATTEMPTS_REACHED",
          409,
          undefined,
          { cause: error },
        );
      default:
        break;
    }
  }

  return new DocumentProcessingError(
    "The processing state could not be persisted.",
    "PROCESSING_PERSISTENCE_FAILED",
    503,
    undefined,
    { cause: error },
  );
}

function toProcessingFailure(error: unknown): ProcessingFailure {
  if (error instanceof DocumentProcessingError) {
    return { code: error.code, message: error.message, error };
  }

  if (error instanceof StorageError) {
    const processingError = new DocumentProcessingError(
      "The source document could not be downloaded from storage.",
      "STORAGE_DOWNLOAD_FAILED",
      503,
      undefined,
      { cause: error },
    );
    return { code: processingError.code, message: processingError.message, error: processingError };
  }

  if (error instanceof DocumentParsingError) {
    const processingError = new DocumentProcessingError(
      error.message,
      "PARSER_FAILED",
      422,
      { parserCode: error.code },
      { cause: error },
    );
    return {
      code: `PARSER_${error.code}`,
      message: error.message,
      error: processingError,
    };
  }

  if (error instanceof DocumentChunkingError) {
    const processingError = new DocumentProcessingError(
      error.message,
      "CHUNKING_FAILED",
      422,
      { chunkerCode: error.code },
      { cause: error },
    );
    return {
      code: `CHUNKER_${error.code}`,
      message: error.message,
      error: processingError,
    };
  }

  if (error instanceof EmbeddingProviderError) {
    const providerDetail = [
      error.diagnostics?.status ? `HTTP ${error.diagnostics.status}` : null,
      error.diagnostics?.providerCode ?? null,
      error.diagnostics?.providerType ?? null,
    ].filter((value): value is string => Boolean(value)).join(" / ");
    const message = providerDetail
      ? `Embeddings could not be generated for the document chunks (${providerDetail}).`
      : "Embeddings could not be generated for the document chunks.";
    const processingError = new DocumentProcessingError(
      message,
      "EMBEDDING_FAILED",
      error.diagnostics?.status && error.diagnostics.status >= 400
        ? error.diagnostics.status
        : 503,
      {
        providerCode: error.code,
        providerStatus: error.diagnostics?.status ?? null,
        providerErrorCode: error.diagnostics?.providerCode ?? null,
        providerErrorType: error.diagnostics?.providerType ?? null,
        providerRequestId: error.diagnostics?.requestId ?? null,
      },
      { cause: error },
    );
    return {
      code: `EMBEDDING_${error.code}`,
      message: processingError.message,
      error: processingError,
    };
  }

  if (error instanceof DocumentProcessingRepositoryError) {
    const processingError = mapRepositoryError(error);
    return {
      code: processingError.code,
      message: processingError.message,
      error: processingError,
    };
  }

  const processingError = new DocumentProcessingError(
    "The document processing pipeline failed.",
    "NORMALIZATION_FAILED",
    500,
    undefined,
    { cause: error },
  );
  return { code: processingError.code, message: processingError.message, error: processingError };
}

function evidenceMetadata(chunk: KnowledgeChunk): JsonObject {
  return {
    ...chunk.metadata,
    evidence: {
      sourceDocumentId: chunk.documentId,
      sourceDocumentName: chunk.sourceDocument.displayName,
      sectionPath: chunk.sectionPath,
      sourceSegments: chunk.sourceSegments.map((segment) => ({
        sourceBlockId: segment.sourceBlockId,
        kind: segment.kind,
        normalizedText: segment.normalizedText,
        sourceBlockText: segment.sourceBlockText,
        normalizedStartChar: segment.normalizedStartChar,
        normalizedEndChar: segment.normalizedEndChar,
        metadata: segment.metadata,
        locator: {
          pageStart: segment.locator.pageStart,
          pageEnd: segment.locator.pageEnd,
          lineStart: segment.locator.lineStart,
          lineEnd: segment.locator.lineEnd,
          startChar: segment.locator.startChar,
          endChar: segment.locator.endChar,
        },
      })),
    },
  };
}

export class DocumentProcessingService {
  constructor(
    private readonly repository: DocumentProcessingRepository,
    private readonly storage: StorageAdapter,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly config: DocumentProcessingConfig,
    private readonly parserLayer: ParserLayer = new ParserLayer(),
    private readonly normalizerLayer: NormalizerLayer = new NormalizerLayer(),
    private readonly chunker: StructuredDocumentChunker = new StructuredDocumentChunker({
      maxTokens: config.chunkMaxTokens,
      overlapTokens: config.chunkOverlapTokens,
    }),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async enqueue(documentId: string): Promise<EnqueueDocumentProcessingResult> {
    validateId(documentId, "The document ID");

    try {
      const document = await this.repository.findDocument(documentId);

      if (!document) {
        throw new DocumentProcessingError(
          "The source document was not found.",
          "DOCUMENT_NOT_FOUND",
          404,
        );
      }

      const activeJob = await this.repository.findActiveJobForDocument(documentId);

      if (activeJob) {
        return { document, job: activeJob, idempotent: true };
      }

      if (document.status === "ready") {
        const completedJob = await this.repository.findLatestJobForDocument(documentId);

        if (completedJob?.status === "completed") {
          return { document, job: completedJob, idempotent: true };
        }
      }

      if (document.status !== "uploaded") {
        const latestJob = await this.repository.findLatestJobForDocument(documentId);
        throw new DocumentProcessingError(
          "Only uploaded documents can start a new processing job.",
          "INVALID_DOCUMENT_STATE",
          409,
          {
            currentStatus: document.status,
            ...(latestJob ? { latestJobId: latestJob.id, latestJobStatus: latestJob.status } : {}),
          },
        );
      }

      const job = await this.repository.createPendingJob({
        documentId,
        idempotencyKey: `phase-2:${documentId}`,
        maxAttempts: this.config.maxAttempts,
        config: {
          chunkMaxTokens: this.config.chunkMaxTokens,
          chunkOverlapTokens: this.config.chunkOverlapTokens,
          embeddingProvider: this.embeddingProvider.provider,
          embeddingModel: this.embeddingProvider.model,
          embeddingModelVersion: this.embeddingProvider.modelVersion,
          embeddingDimension: this.embeddingProvider.dimensions,
        },
      });

      return { document, job, idempotent: false };
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  async run(jobId: string): Promise<RunDocumentProcessingResult> {
    validateId(jobId, "The processing job ID");
    let claimed = false;

    try {
      claimed = await this.repository.claimJob(jobId, this.now().toISOString());

      if (!claimed) {
        const [job, document] = await Promise.all([
          this.repository.findJob(jobId),
          this.documentForJob(jobId),
        ]);

        if (!job) {
          throw new DocumentProcessingError(
            "The processing job was not found.",
            "JOB_NOT_FOUND",
            404,
          );
        }

        return { document, job, executed: false };
      }

      const job = await this.requireJob(jobId);
      const document = await this.requireDocument(job.documentId);
      const storedObject = await this.storage.downloadObject(
        document.storageBucket,
        document.storagePath,
      );

      if (storedObject.sizeBytes !== document.fileSizeBytes) {
        throw new DocumentProcessingError(
          "The stored object size no longer matches the uploaded document.",
          "STORAGE_OBJECT_MISMATCH",
          409,
          {
            expectedSizeBytes: document.fileSizeBytes,
            actualSizeBytes: storedObject.sizeBytes,
          },
        );
      }

      const parsed = await this.parserLayer.parse({
        documentId: document.id,
        displayName: document.displayName,
        mimeType: document.mimeType,
        fileExtension: document.fileExtension,
        metadata: document.metadata,
        content: storedObject.data,
      });

      const reviewWarnings = reviewRequiredExtractionWarnings(parsed.metadata);
      await this.repository.updateProgress(jobId, "chunk", 35);
      const normalized = this.normalizerLayer.normalize(parsed);
      const chunks = this.chunker.chunk(normalized);
      const chunkWarnings = new Map<number, ReturnType<typeof reviewRequiredExtractionWarnings>>();
      const eligibleChunks = chunks.filter((chunk, index) => {
        const warnings = reviewWarningsForSources(reviewWarnings, chunk.sourceSegments.map((segment) => ({
            pageStart: segment.locator.pageStart,
            pageEnd: segment.locator.pageEnd,
            metadata: segment.metadata,
          })));
        chunkWarnings.set(index, warnings);
        return warnings.length === 0;
      });
      if (eligibleChunks.length === 0) {
        const reviewPages = [...new Set(reviewWarnings.flatMap((warning) =>
          warning.pageNumber === undefined ? [] : [warning.pageNumber],
        ))];
        const reviewLocations = [...new Set(reviewWarnings.flatMap((warning) =>
          warning.location ? [warning.location] : [],
        ))];
        const location = reviewPages.length > 0
          ? ` on page${reviewPages.length === 1 ? "" : "s"} ${reviewPages.join(", ")}`
          : reviewLocations.length > 0
            ? ` at ${reviewLocations.join(", ")}`
            : "";
        const missingContent = [...new Set(reviewWarnings.map((warning) => warning.message))].join(" ");
        const remediation = [...new Set(reviewWarnings.map((warning) => extractionWarningRemediation(warning.code)))].join(" ");
        throw new DocumentProcessingError(
          `Review required${location}. ${missingContent} ${remediation} No verified content remains available for question answering.`,
          "PARSER_REVIEW_REQUIRED",
          422,
          { reviewPages, reviewLocations, warnings: reviewWarnings, eligibleChunkCount: 0 },
        );
      }

      await this.repository.updateProgress(jobId, "embed", 55);
      const embeddingBatch = await this.embeddingProvider.embed(
        eligibleChunks.map((chunk) => chunk.text),
      );

      if (
        embeddingBatch.vectors.length !== eligibleChunks.length ||
        embeddingBatch.dimensions !== EMBEDDING_DIMENSION
      ) {
        throw new DocumentProcessingError(
          "The embedding provider returned vectors that do not match the storage schema.",
          "EMBEDDING_FAILED",
          503,
          {
            expectedVectors: eligibleChunks.length,
            actualVectors: embeddingBatch.vectors.length,
            expectedDimensions: EMBEDDING_DIMENSION,
            actualDimensions: embeddingBatch.dimensions,
          },
        );
      }

      await this.repository.updateProgress(jobId, "finalize", 95);

      const persistedChunks: PersistedProcessingChunk[] = eligibleChunks.map((chunk, index) => {
        const embedding = embeddingBatch.vectors[index];

        if (!embedding) {
          throw new DocumentProcessingError(
            "An embedding vector is missing for a document chunk.",
            "EMBEDDING_FAILED",
            503,
            { chunkIndex: index },
          );
        }

        return {
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          textHash: chunk.textHash,
          tokenCount: chunk.tokenCount,
          pageStart: chunk.locator.pageStart,
          pageEnd: chunk.locator.pageEnd,
          startChar: chunk.locator.startChar,
          endChar: chunk.locator.endChar,
          sectionPath: chunk.sectionPath.join(" > "),
          metadata: {
            ...evidenceMetadata(chunk),
            qaEligibility: { status: "eligible", reviewWarnings: [] },
          },
          embedding,
          embeddingProvider: embeddingBatch.provider,
          embeddingModel: embeddingBatch.model,
          embeddingModelVersion: embeddingBatch.modelVersion,
          embeddingDimension: embeddingBatch.dimensions,
          embeddedAt: embeddingBatch.embeddedAt,
        };
      });

      await this.repository.completeJob({
        jobId,
        parserName: parsed.parser.name,
        parserVersion: parsed.parser.version,
        pageCount: normalized.pageCount,
        charCount: normalized.charCount,
        tokenCount: estimateTokenCount(normalized.text),
        processingMetadata: {
          title: normalized.title,
          normalizedMetadata: normalized.metadata,
          parser: normalized.parser,
          normalizer: normalized.normalizer,
          chunker: chunks[0]?.metadata.chunker ?? null,
          qaEligibility: {
            status: reviewWarnings.length === 0 && eligibleChunks.length === chunks.length ? "complete" : "partial",
            eligibleChunkCount: eligibleChunks.length,
            excludedChunkCount: chunks.length - eligibleChunks.length,
            excludedChunkIndexes: [...chunkWarnings.entries()]
              .filter(([, warnings]) => warnings.length > 0)
              .map(([index]) => index),
            warnings: reviewWarnings.map((warning) => ({ ...warning })),
          },
        },
        chunks: persistedChunks,
        completedAt: this.now().toISOString(),
      });

      // The database has atomically published the document as ready. If the
      // follow-up read fails, do not attempt to turn an already-completed job
      // back into a failed job.
      claimed = false;

      const [completedJob, readyDocument] = await Promise.all([
        this.requireJob(jobId),
        this.requireDocument(document.id),
      ]);

      return { document: readyDocument, job: completedJob, executed: true };
    } catch (error) {
      const failure = toProcessingFailure(error);

      if (claimed) {
        try {
          await this.repository.failJob({
            jobId,
            errorCode: failure.code.slice(0, 120),
            errorMessage: failure.message.slice(0, 1_000),
            failedAt: this.now().toISOString(),
          });
        } catch (recordingError) {
          console.error("Could not persist the document processing failure", {
            jobId,
            recordingError,
          });
        }
      }

      throw failure.error;
    }
  }

  async retry(jobId: string): Promise<RetryDocumentProcessingResult> {
    validateId(jobId, "The processing job ID");

    try {
      const current = await this.repository.findJob(jobId);

      if (!current) {
        throw new DocumentProcessingError(
          "The processing job was not found.",
          "JOB_NOT_FOUND",
          404,
        );
      }

      if (current.status === "pending" || current.status === "processing") {
        return {
          job: current,
          document: await this.requireDocument(current.documentId),
          idempotent: true,
        };
      }

      if (current.status === "completed") {
        throw new DocumentProcessingError(
          "Completed processing jobs cannot be retried.",
          "INVALID_JOB_STATE",
          409,
          { currentStatus: current.status },
        );
      }

      if (current.status === "failed") {
        await this.repository.markRetry(jobId);
      }

      const pending = await this.repository.requeueRetry(jobId);
      return {
        job: pending,
        document: await this.requireDocument(pending.documentId),
        idempotent: false,
      };
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  async getJob(jobId: string): Promise<DocumentProcessingJob> {
    validateId(jobId, "The processing job ID");

    try {
      return await this.requireJob(jobId);
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  async getDocument(documentId: string): Promise<{
    document: ProcessingDocumentRecord;
    latestJob: DocumentProcessingJob | null;
  }> {
    validateId(documentId, "The document ID");

    try {
      const document = await this.requireDocument(documentId);
      const latestJob = await this.repository.findLatestJobForDocument(documentId);
      return { document, latestJob };
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  private async requireJob(jobId: string): Promise<DocumentProcessingJob> {
    const job = await this.repository.findJob(jobId);

    if (!job) {
      throw new DocumentProcessingError(
        "The processing job was not found.",
        "JOB_NOT_FOUND",
        404,
      );
    }

    return job;
  }

  private async requireDocument(documentId: string): Promise<ProcessingDocumentRecord> {
    const document = await this.repository.findDocument(documentId);

    if (!document) {
      throw new DocumentProcessingError(
        "The source document was not found.",
        "DOCUMENT_NOT_FOUND",
        404,
      );
    }

    return document;
  }

  private async documentForJob(jobId: string): Promise<ProcessingDocumentRecord> {
    const job = await this.requireJob(jobId);
    return this.requireDocument(job.documentId);
  }
}
