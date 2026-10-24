import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it } from "vitest";

import { vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  DocumentProcessingJob,
  DocumentProcessingStage,
  EmbeddingVector,
} from "@/domain";
import type {
  CreateSignedUploadInput,
  DownloadedStorageObject,
  SignedUpload,
  StorageAdapter,
  StorageObjectMetadata,
} from "@/infrastructure/storage/storage-adapter";

import type {
  CompleteProcessingJobInput,
  CreateProcessingJobInput,
  DocumentProcessingRepository,
  FailProcessingJobInput,
  PersistedProcessingChunk,
  ProcessingDocumentRecord,
} from "./document-processing-repository";
import { DocumentProcessingRepositoryError } from "./document-processing-repository";
import { DocumentProcessingService } from "./document-processing-service";
import type { EmbeddingBatch } from "@/providers";
import { ImageDocumentParser, ParserLayer, PdfDocumentParser } from "@/features/knowledge-processing/content/parser";
import type { ImageOcrProvider } from "@/features/knowledge-processing/content/image-ocr";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000020";
const KNOWLEDGE_BASE_ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-08-02T00:00:00.000Z";

function createDocument(content: Uint8Array): ProcessingDocumentRecord {
  return {
    id: DOCUMENT_ID,
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    displayName: "Activation Notes",
    originalFilename: "activation.md",
    mimeType: "text/markdown",
    fileExtension: "md",
    storageBucket: "knowledge-files",
    storagePath: `documents/${DOCUMENT_ID}/activation.md`,
    fileSizeBytes: content.byteLength,
    status: "uploaded",
    processingStage: null,
    progressPct: 100,
    metadata: { sourceSystem: "test" },
    parserName: null,
    parserVersion: null,
    pageCount: null,
    charCount: null,
    tokenCount: null,
    chunkCount: 0,
    errorCode: null,
    errorMessage: null,
    uploadedAt: NOW,
    processedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

class MemoryStorageAdapter implements StorageAdapter {
  constructor(private readonly content: Uint8Array) {}

  async createSignedUpload(input: CreateSignedUploadInput): Promise<SignedUpload> {
    return {
      bucket: input.bucket,
      path: input.path,
      token: "token",
      signedUrl: "https://example.test/upload",
      expiresInSeconds: 60,
    };
  }

  async getObjectMetadata(): Promise<StorageObjectMetadata> {
    return { exists: true, sizeBytes: this.content.byteLength, contentType: "text/markdown" };
  }

  async createSignedDownload() {
    return { signedUrl: "https://example.test/signed-preview", expiresInSeconds: 60 };
  }

  async downloadObject(): Promise<DownloadedStorageObject> {
    return {
      data: this.content,
      sizeBytes: this.content.byteLength,
      contentType: "text/markdown",
    };
  }

  async removeObject(): Promise<void> {}
}

class FakeEmbeddingProvider {
  readonly provider = "fake";
  readonly model = "fake-embedding-3-small";
  readonly modelVersion = "test-2026-08-02";
  readonly dimensions = 1536;
  calls = 0;

  async embed(inputs: readonly string[]): Promise<EmbeddingBatch> {
    this.calls += 1;
    return {
      provider: this.provider,
      model: this.model,
      modelVersion: this.modelVersion,
      dimensions: this.dimensions,
      embeddedAt: NOW,
      vectors: inputs.map((_, index) => {
        const vector = new Array<number>(this.dimensions).fill(0);
        vector[0] = index + 1;
        return vector as EmbeddingVector;
      }),
      usageTokens: inputs.length,
    };
  }
}

class MemoryProcessingRepository implements DocumentProcessingRepository {
  readonly jobs = new Map<string, DocumentProcessingJob>();
  readonly persistedChunks = new Map<string, PersistedProcessingChunk[]>();

  constructor(readonly document: ProcessingDocumentRecord) {}

  async findDocument(): Promise<ProcessingDocumentRecord | null> {
    return this.document;
  }

  async findJob(jobId: string): Promise<DocumentProcessingJob | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async findActiveJobForDocument(documentId: string): Promise<DocumentProcessingJob | null> {
    return (
      [...this.jobs.values()].find(
        (job) =>
          job.documentId === documentId &&
          (job.status === "pending" || job.status === "processing"),
      ) ?? null
    );
  }

  async findLatestJobForDocument(documentId: string): Promise<DocumentProcessingJob | null> {
    return (
      [...this.jobs.values()]
        .filter((job) => job.documentId === documentId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
    );
  }

  async createPendingJob(input: CreateProcessingJobInput): Promise<DocumentProcessingJob> {
    const job: DocumentProcessingJob = {
      id: randomUUID(),
      documentId: input.documentId,
      stage: "parse",
      status: "pending",
      attempt: 1,
      maxAttempts: input.maxAttempts,
      progressPct: 0,
      idempotencyKey: input.idempotencyKey,
      config: input.config,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async claimJob(jobId: string, startedAt: string): Promise<boolean> {
    const job = this.requireJob(jobId);
    if (job.status === "processing") return false;
    if (job.status !== "pending") throw new Error("invalid state");
    job.status = "processing";
    job.stage = "parse";
    job.progressPct = 5;
    job.startedAt = startedAt;
    this.document.status = "processing";
    this.document.processingStage = "parse";
    this.document.progressPct = 5;
    return true;
  }

  async updateProgress(
    jobId: string,
    stage: DocumentProcessingStage,
    progressPct: number,
  ): Promise<void> {
    const job = this.requireJob(jobId);
    job.stage = stage;
    job.progressPct = progressPct;
    this.document.processingStage = stage;
    this.document.progressPct = progressPct;
  }

  async completeJob(input: CompleteProcessingJobInput): Promise<void> {
    const job = this.requireJob(input.jobId);
    job.status = "completed";
    job.stage = "finalize";
    job.progressPct = 100;
    job.finishedAt = input.completedAt;
    this.persistedChunks.set(input.jobId, [...input.chunks]);
    this.document.status = "ready";
    this.document.processingStage = "finalize";
    this.document.progressPct = 100;
    this.document.parserName = input.parserName;
    this.document.parserVersion = input.parserVersion;
    this.document.pageCount = input.pageCount;
    this.document.charCount = input.charCount;
    this.document.tokenCount = input.tokenCount;
    this.document.chunkCount = input.chunks.length;
    this.document.processedAt = input.completedAt;
    this.document.metadata = {
      ...this.document.metadata,
      processing: input.processingMetadata,
    };
  }

  async failJob(input: FailProcessingJobInput): Promise<void> {
    const job = this.requireJob(input.jobId);
    job.status = "failed";
    job.errorCode = input.errorCode;
    job.errorMessage = input.errorMessage;
    job.finishedAt = input.failedAt;
    this.document.status = "failed";
    this.document.errorCode = input.errorCode;
    this.document.errorMessage = input.errorMessage;
  }

  async markRetry(jobId: string): Promise<DocumentProcessingJob> {
    const job = this.requireJob(jobId);
    if (job.status !== "failed") throw new Error("invalid retry state");
    if (job.attempt >= job.maxAttempts) {
      throw new DocumentProcessingRepositoryError("max attempts", "MAX_ATTEMPTS_REACHED");
    }
    job.status = "retry";
    return job;
  }

  async requeueRetry(jobId: string): Promise<DocumentProcessingJob> {
    const job = this.requireJob(jobId);
    if (job.status !== "retry") throw new Error("invalid requeue state");
    job.status = "pending";
    job.attempt += 1;
    job.stage = "parse";
    job.progressPct = 0;
    job.errorCode = null;
    job.errorMessage = null;
    return job;
  }

  private requireJob(jobId: string): DocumentProcessingJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("job not found");
    return job;
  }
}

function createService(content: string | Uint8Array, parserLayer = new ParserLayer()) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const repository = new MemoryProcessingRepository(createDocument(bytes));
  const embeddingProvider = new FakeEmbeddingProvider();
  const service = new DocumentProcessingService(
    repository,
    new MemoryStorageAdapter(bytes),
    embeddingProvider,
    { maxAttempts: 2, chunkMaxTokens: 24, chunkOverlapTokens: 3 },
    parserLayer,
    undefined,
    undefined,
    () => new Date(NOW),
  );
  return { repository, service, embeddingProvider };
}

describe("DocumentProcessingService", () => {
  beforeEach(() => {
    // Keep the test clock explicit because embedding provenance is persisted.
  });

  it("runs Document → Parser → Normalizer → Chunker → Embedding → READY", async () => {
    const { repository, service } = createService(
      "# Activation\n\n## Friction\n\nUsers cannot find the next step after signup. Support sees repeated questions.",
    );

    const enqueued = await service.enqueue(DOCUMENT_ID);
    expect(enqueued.job.status).toBe("pending");
    expect(repository.document.status).toBe("uploaded");

    const completed = await service.run(enqueued.job.id);
    const chunks = repository.persistedChunks.get(enqueued.job.id);

    expect(completed.executed).toBe(true);
    expect(completed.document.status).toBe("ready");
    expect(completed.job.status).toBe("completed");
    expect(completed.document.chunkCount).toBeGreaterThan(0);
    expect(chunks?.[0]?.embeddingProvider).toBe("fake");
    expect(chunks?.[0]?.embeddingDimension).toBe(1536);
    expect(chunks?.[0]?.embeddedAt).toBe(NOW);
    expect(chunks?.[0]?.sectionPath).toContain("Activation");
    expect(chunks?.[0]?.metadata.evidence).toBeTruthy();
    expect(completed.document.metadata.processing).toMatchObject({
      normalizedMetadata: {
        source: { sourceSystem: "test" },
      },
    });
  });

  it("records failure and advances through retry back to pending", async () => {
    const { repository, service } = createService(new Uint8Array([0xff]));
    const enqueued = await service.enqueue(DOCUMENT_ID);

    await expect(service.run(enqueued.job.id)).rejects.toMatchObject({
      code: "PARSER_FAILED",
    });
    expect(repository.document.status).toBe("failed");
    expect(repository.jobs.get(enqueued.job.id)?.status).toBe("failed");

    const retried = await service.retry(enqueued.job.id);
    expect(retried.job.status).toBe("pending");
    expect(retried.job.attempt).toBe(2);
  });

  it("embeds only the readable page of a mixed scan PDF and marks the document partial", async () => {
    const pdfParser = new PdfDocumentParser(async () => ({
      pageCount: 2,
      title: null,
      metadata: {},
      pages: [
        { pageNumber: 1, text: "Readable page" },
        { pageNumber: 2, text: "   " },
      ],
    }));
    const { repository, service, embeddingProvider } = createService(
      "# mixed scan",
      new ParserLayer([pdfParser]),
    );
    repository.document.mimeType = "application/pdf";
    repository.document.fileExtension = "pdf";
    repository.document.originalFilename = "mixed-scan.pdf";

    const enqueued = await service.enqueue(DOCUMENT_ID);
    await expect(service.run(enqueued.job.id)).resolves.toMatchObject({ executed: true });

    expect(embeddingProvider.calls).toBe(1);
    expect(repository.persistedChunks.get(enqueued.job.id)).toHaveLength(1);
    expect(repository.persistedChunks.get(enqueued.job.id)?.[0]?.text).toContain("Readable page");
    expect(repository.document.status).toBe("ready");
    expect(repository.document.metadata.processing).toMatchObject({
      qaEligibility: { status: "partial", eligibleChunkCount: 1, warnings: [{ pageNumber: 2 }] },
    });
  });

  it("allows high-confidence printed OCR into the index while preserving a review notice", async () => {
    const ocrProvider: ImageOcrProvider = {
      recognize: async () => ({
        lines: [{
          text: "库存准确率 98.7%",
          confidence: 96,
          minimumWordConfidence: 96,
          bounds: { left: 20, top: 10, right: 200, bottom: 40 },
          words: [{
            text: "98.7%",
            confidence: 96,
            bounds: { left: 150, top: 10, right: 200, bottom: 40 },
          }],
        }],
        averageConfidence: 96,
        minimumWordConfidence: 96,
        wordCount: 1,
      }),
    };
    const { repository, service, embeddingProvider } = createService(
      new Uint8Array([1, 2, 3]),
      new ParserLayer([new ImageDocumentParser(ocrProvider)]),
    );
    repository.document.mimeType = "image/png";
    repository.document.fileExtension = "png";
    repository.document.originalFilename = "inspection.png";
    const enqueued = await service.enqueue(DOCUMENT_ID);

    await expect(service.run(enqueued.job.id)).resolves.toMatchObject({ executed: true });
    expect(embeddingProvider.calls).toBe(1);
    expect(repository.persistedChunks.get(enqueued.job.id)?.[0]?.text).toContain("库存准确率 98.7%");
    expect(repository.document.status).toBe("ready");
    expect(repository.document.metadata.processing).toMatchObject({
      normalizedMetadata: { extracted: { extractionWarnings: [expect.objectContaining({
        code: "OCR_VISUAL_REVIEW_REQUIRED",
        severity: "notice",
      })] } },
      qaEligibility: { status: "complete", eligibleChunkCount: 1 },
    });
  });

  it("blocks low-confidence OCR output from embedding and keeps the source-specific remediation", async () => {
    const ocrProvider: ImageOcrProvider = {
      recognize: async () => ({
        lines: [{
          text: "库存准确率 98.7%",
          confidence: 42,
          minimumWordConfidence: 42,
          bounds: { left: 20, top: 10, right: 200, bottom: 40 },
          words: [{
            text: "98.7%",
            confidence: 42,
            bounds: { left: 150, top: 10, right: 200, bottom: 40 },
          }],
        }],
        averageConfidence: 42,
        minimumWordConfidence: 42,
        wordCount: 1,
      }),
    };
    const { repository, service, embeddingProvider } = createService(
      new Uint8Array([1, 2, 3]),
      new ParserLayer([new ImageDocumentParser(ocrProvider)]),
    );
    repository.document.mimeType = "image/png";
    repository.document.fileExtension = "png";
    repository.document.originalFilename = "inspection.png";
    const enqueued = await service.enqueue(DOCUMENT_ID);

    await expect(service.run(enqueued.job.id)).rejects.toMatchObject({
      code: "PARSER_REVIEW_REQUIRED",
    });
    expect(embeddingProvider.calls).toBe(0);
    expect(repository.persistedChunks.has(enqueued.job.id)).toBe(false);
    expect(repository.document.errorMessage).toContain("OCR confidence is below the acceptance threshold");
  });

  it("excludes PPTX chart-cache chunks but retains independently extracted slide text", async () => {
    const content = new Uint8Array(await readFile(new URL(
      "../../../../evals/document-reliability/fixtures/18_quarterly_strategy.pptx",
      import.meta.url,
    )));
    const { repository, service, embeddingProvider } = createService(content);
    repository.document.mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    repository.document.fileExtension = "pptx";
    repository.document.originalFilename = "18_quarterly_strategy.pptx";
    repository.document.displayName = "18_quarterly_strategy.pptx";
    const enqueued = await service.enqueue(DOCUMENT_ID);

    await expect(service.run(enqueued.job.id)).resolves.toMatchObject({ executed: true });
    expect(embeddingProvider.calls).toBe(1);
    const persisted = repository.persistedChunks.get(enqueued.job.id) ?? [];
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted.every((chunk) => !chunk.text.includes("Chart ("))).toBe(true);
    expect(repository.document.status).toBe("ready");
    expect(repository.document.metadata.processing).toMatchObject({
      qaEligibility: { status: "partial", excludedChunkCount: expect.any(Number) },
    });
  });
});
