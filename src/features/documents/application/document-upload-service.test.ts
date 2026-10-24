import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DocumentUploadError } from "@/features/documents/application/document-upload-error";
import type {
  DocumentUploadRecord,
  DocumentUploadRepository,
  UploadingDocumentRecord,
} from "@/features/documents/application/document-upload-repository";
import { DocumentUploadService } from "@/features/documents/application/document-upload-service";
import type {
  CreateSignedUploadInput,
  SignedUpload,
  StorageAdapter,
  StorageObjectMetadata,
} from "@/infrastructure/storage/storage-adapter";
import { StorageError } from "@/infrastructure/storage/storage-error";

const KNOWLEDGE_BASE_ID = "00000000-0000-4000-8000-000000000001";
const SHA_256 = "a".repeat(64);
const NOW = "2026-08-02T00:00:00.000Z";

class MemoryDocumentUploadRepository implements DocumentUploadRepository {
  readonly records = new Map<string, DocumentUploadRecord>();
  readonly failedTransitions: Array<{
    id: string;
    errorCode: string;
    errorMessage: string;
  }> = [];

  async createUploading(record: UploadingDocumentRecord): Promise<DocumentUploadRecord> {
    const created: DocumentUploadRecord = {
      ...record,
      status: "uploading",
      uploadedAt: null,
      errorCode: null,
      errorMessage: null,
      createdAt: NOW,
      updatedAt: NOW,
    };

    this.records.set(record.id, created);
    return created;
  }

  async findById(id: string): Promise<DocumentUploadRecord | null> {
    return this.records.get(id) ?? null;
  }

  async markUploaded(id: string, uploadedAt: string): Promise<DocumentUploadRecord> {
    const current = this.records.get(id);

    if (!current) {
      throw new Error("Document not found");
    }

    const updated: DocumentUploadRecord = {
      ...current,
      status: "uploaded",
      uploadedAt,
      errorCode: null,
      errorMessage: null,
      updatedAt: uploadedAt,
    };
    this.records.set(id, updated);
    return updated;
  }

  async markFailed(id: string, errorCode: string, errorMessage: string): Promise<void> {
    this.failedTransitions.push({ id, errorCode, errorMessage });
    const current = this.records.get(id);

    if (current) {
      this.records.set(id, {
        ...current,
        status: "failed",
        errorCode,
        errorMessage,
      });
    }
  }

  async markDeleting(id: string): Promise<DocumentUploadRecord> {
    const current = this.records.get(id);
    if (!current) throw new Error("Document not found");
    const deleting = { ...current, status: "deleting" as const };
    this.records.set(id, deleting);
    return deleting;
  }

  async markDeleted(id: string, deletedAt: string): Promise<void> {
    const current = this.records.get(id);
    if (!current) throw new Error("Document not found");
    this.records.set(id, { ...current, status: "deleted", updatedAt: deletedAt });
  }
}

class FakeStorageAdapter implements StorageAdapter {
  metadata: StorageObjectMetadata = {
    exists: true,
    sizeBytes: 1_024,
    contentType: "application/pdf",
  };
  createError: Error | null = null;
  lookupError: Error | null = null;
  readonly signedUploadInputs: CreateSignedUploadInput[] = [];
  readonly removedObjects: Array<{ bucket: string; path: string }> = [];
  removeError: Error | null = null;

  async createSignedUpload(input: CreateSignedUploadInput): Promise<SignedUpload> {
    this.signedUploadInputs.push(input);

    if (this.createError) {
      throw this.createError;
    }

    return {
      bucket: input.bucket,
      path: input.path,
      token: "upload-token",
      signedUrl: "https://storage.example.test/upload",
      expiresInSeconds: 7_200,
    };
  }

  async getObjectMetadata(): Promise<StorageObjectMetadata> {
    if (this.lookupError) {
      throw this.lookupError;
    }

    return this.metadata;
  }

  async createSignedDownload() {
    return { signedUrl: "https://storage.example.test/signed-preview", expiresInSeconds: 60 };
  }

  async downloadObject() {
    return {
      data: new Uint8Array(),
      sizeBytes: 0,
      contentType: null,
    };
  }

  async removeObject(bucket: string, path: string): Promise<void> {
    if (this.removeError) throw this.removeError;
    this.removedObjects.push({ bucket, path });
  }
}

function createService() {
  const repository = new MemoryDocumentUploadRepository();
  const storage = new FakeStorageAdapter();
  const service = new DocumentUploadService(repository, storage, {
    bucket: "knowledge-files",
    maxDocumentSizeBytes: 20 * 1024 * 1024,
  });

  return { repository, storage, service };
}

function validInitializeInput() {
  return {
    displayName: "Customer feedback",
    filename: "customer-feedback.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1_024,
    sha256: SHA_256,
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
  };
}

async function expectUploadError(
  promise: Promise<unknown>,
  code: DocumentUploadError["code"],
  httpStatus: number,
): Promise<DocumentUploadError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentUploadError);
    const uploadError = error as DocumentUploadError;
    expect(uploadError.code).toBe(code);
    expect(uploadError.httpStatus).toBe(httpStatus);
    return uploadError;
  }

  throw new Error("Expected DocumentUploadError");
}

describe("DocumentUploadService", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("initializes a private signed upload under the knowledge base and document path", async () => {
    const { repository, storage, service } = createService();

    const result = await service.initialize(validInitializeInput());

    expect(result.document.status).toBe("uploading");
    expect(result.document.knowledgeBaseId).toBe(KNOWLEDGE_BASE_ID);
    expect(result.document.sha256).toBe(SHA_256);
    expect(result.upload.bucket).toBe("knowledge-files");
    expect(result.upload.path).toMatch(
      new RegExp(
        `^knowledge-bases/${KNOWLEDGE_BASE_ID}/documents/[0-9a-f-]+/v1-customer-feedback\\.pdf$`,
      ),
    );
    expect(storage.signedUploadInputs).toEqual([
      {
        bucket: "knowledge-files",
        path: result.upload.path,
        upsert: false,
      },
    ]);
    expect(repository.records.get(result.document.id)?.status).toBe("uploading");
  });

  it("uses the seeded default knowledge base when none is supplied", async () => {
    const { service } = createService();

    const result = await service.initialize({
      ...validInitializeInput(),
      knowledgeBaseId: undefined,
    });

    expect(result.document.knowledgeBaseId).toBe(KNOWLEDGE_BASE_ID);
  });

  it("uses an ASCII storage filename while preserving a non-ASCII display filename", async () => {
    const { service } = createService();

    const result = await service.initialize({
      ...validInitializeInput(),
      filename: "产品分析实验测试文档.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    expect(result.document.originalFilename).toBe("产品分析实验测试文档.docx");
    expect(result.document.storagePath).toMatch(
      new RegExp(
        `^knowledge-bases/${KNOWLEDGE_BASE_ID}/documents/[0-9a-f-]+/v1-document\\.docx$`,
      ),
    );
  });

  it.each([
    ["financials.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["strategy.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["chart.png", "image/png"],
    ["scan.jpg", "image/jpeg"],
    ["scan.jpeg", "image/jpeg"],
  ])("accepts supported document upload %s", async (filename, mimeType) => {
    const { service } = createService();
    const result = await service.initialize({
      ...validInitializeInput(),
      filename,
      mimeType,
    });

    expect(result.document.fileExtension).toBe(filename.split(".").pop());
    expect(result.document.mimeType).toBe(mimeType);
  });

  it("rejects unsupported file types before creating a database record", async () => {
    const { repository, service } = createService();

    await expectUploadError(
      service.initialize({
        ...validInitializeInput(),
        filename: "customer-feedback.csv",
        mimeType: "text/csv",
      }),
      "UNSUPPORTED_FILE_TYPE",
      415,
    );

    expect(repository.records.size).toBe(0);
  });

  it("accepts PNG uploads for the OCR review-gated processing path", async () => {
    const { repository, service } = createService();

    const result = await service.initialize({
      ...validInitializeInput(),
      filename: "handwritten-notes.png",
      mimeType: "image/png",
    });

    expect(result.document.fileExtension).toBe("png");
    expect(result.document.mimeType).toBe("image/png");
    expect(repository.records.size).toBe(1);
  });

  it("marks the document failed when Storage cannot create a signed upload", async () => {
    const { repository, storage, service } = createService();
    storage.createError = new StorageError(
      "Storage unavailable",
      "SIGNED_UPLOAD_CREATE_FAILED",
    );

    await expectUploadError(
      service.initialize(validInitializeInput()),
      "STORAGE_UNAVAILABLE",
      503,
    );

    expect(repository.records.size).toBe(1);
    expect([...repository.records.values()][0]?.status).toBe("failed");
    expect(repository.failedTransitions[0]?.errorCode).toBe("STORAGE_SIGNED_UPLOAD_FAILED");
  });

  it("completes a verified upload and makes repeated completion idempotent", async () => {
    const { service } = createService();
    const initialized = await service.initialize(validInitializeInput());

    const completed = await service.complete(initialized.document.id);
    const repeated = await service.complete(initialized.document.id);

    expect(completed.document.status).toBe("uploaded");
    expect(completed.idempotent).toBe(false);
    expect(repeated.document.status).toBe("uploaded");
    expect(repeated.idempotent).toBe(true);
  });

  it("creates a short-lived preview URL only after upload completion", async () => {
    const { service } = createService();
    const initialized = await service.initialize(validInitializeInput());

    await expectUploadError(service.createPreview(initialized.document.id), "DOCUMENT_NOT_FOUND", 404);
    await service.complete(initialized.document.id);
    const preview = await service.createPreview(initialized.document.id);

    expect(preview.signedUrl).toBe("https://storage.example.test/signed-preview");
    expect(Date.parse(preview.expiresAt)).toBeGreaterThan(Date.now());
    expect(preview.document.originalFilename).toBe("customer-feedback.pdf");
  });

  it("removes the private object and soft-deletes the owned document", async () => {
    const { repository, storage, service } = createService();
    const initialized = await service.initialize(validInitializeInput());

    const deleted = await service.delete(initialized.document.id);

    expect(deleted.documentId).toBe(initialized.document.id);
    expect(deleted.idempotent).toBe(false);
    expect(repository.records.get(initialized.document.id)?.status).toBe("deleted");
    expect(storage.removedObjects).toEqual([{
      bucket: "knowledge-files",
      path: initialized.document.storagePath,
    }]);
  });

  it("leaves a failed state and keeps the document when private storage deletion fails", async () => {
    const { repository, storage, service } = createService();
    const initialized = await service.initialize(validInitializeInput());
    storage.removeError = new StorageError("Storage unavailable", "OBJECT_DELETE_FAILED");

    await expectUploadError(service.delete(initialized.document.id), "STORAGE_UNAVAILABLE", 503);

    expect(repository.records.get(initialized.document.id)?.status).toBe("failed");
    expect(repository.records.get(initialized.document.id)?.errorCode).toBe("DOCUMENT_DELETE_FAILED");
    expect(storage.removedObjects).toEqual([]);
  });

  it("does not report file retention when storage deletion succeeds but metadata sync fails", async () => {
    const repository = new MemoryDocumentUploadRepository();
    const storage = new FakeStorageAdapter();
    const service = new DocumentUploadService(repository, storage, {
      bucket: "knowledge-files",
      maxDocumentSizeBytes: 20 * 1024 * 1024,
    });
    const initialized = await service.initialize(validInitializeInput());
    repository.markDeleted = async () => { throw new Error("Database unavailable"); };

    const error = await expectUploadError(service.delete(initialized.document.id), "DATABASE_UNAVAILABLE", 503);

    expect(error.message).not.toContain("仍保留");
    expect(storage.removedObjects).toHaveLength(1);
    expect(repository.records.get(initialized.document.id)?.status).toBe("deleting");
  });

  it("does not advance state when the uploaded object is missing", async () => {
    const { repository, storage, service } = createService();
    const initialized = await service.initialize(validInitializeInput());
    storage.metadata = { exists: false, sizeBytes: null, contentType: null };

    await expectUploadError(
      service.complete(initialized.document.id),
      "UPLOAD_NOT_FOUND",
      409,
    );

    expect(repository.records.get(initialized.document.id)?.status).toBe("uploading");
  });

  it("rejects completion when the document state machine disallows uploaded", async () => {
    const { repository, service } = createService();
    const initialized = await service.initialize(validInitializeInput());
    const current = repository.records.get(initialized.document.id);

    if (!current) {
      throw new Error("Expected initialized document");
    }

    repository.records.set(initialized.document.id, {
      ...current,
      status: "failed",
      errorCode: "UPLOAD_EXPIRED",
      errorMessage: "The signed upload expired.",
    });

    const error = await expectUploadError(
      service.complete(initialized.document.id),
      "INVALID_DOCUMENT_STATE",
      409,
    );

    expect(error.details).toEqual({ currentStatus: "failed" });
  });

  it("marks the document failed when uploaded size differs from initialized size", async () => {
    const { repository, storage, service } = createService();
    const initialized = await service.initialize(validInitializeInput());
    storage.metadata = {
      exists: true,
      sizeBytes: 2_048,
      contentType: "application/pdf",
    };

    const error = await expectUploadError(
      service.complete(initialized.document.id),
      "UPLOAD_SIZE_MISMATCH",
      409,
    );

    expect(error.details).toEqual({ expectedSizeBytes: 1_024, actualSizeBytes: 2_048 });
    expect(repository.records.get(initialized.document.id)?.status).toBe("failed");
  });

  it("marks the document failed when uploaded content type differs", async () => {
    const { repository, storage, service } = createService();
    const initialized = await service.initialize(validInitializeInput());
    storage.metadata = {
      exists: true,
      sizeBytes: 1_024,
      contentType: "text/plain; charset=utf-8",
    };

    await expectUploadError(
      service.complete(initialized.document.id),
      "UPLOAD_CONTENT_TYPE_MISMATCH",
      409,
    );

    expect(repository.records.get(initialized.document.id)?.status).toBe("failed");
  });
});
