import { describe, expect, it } from "vitest";

import {
  PROCESSING_JOB_STATUSES,
  canTransitionDocumentStatus,
  canTransitionProcessingJobStatus,
} from "./documents";

describe("document status transitions", () => {
  it("allows the normal upload and ingestion path", () => {
    expect(canTransitionDocumentStatus("uploading", "uploaded")).toBe(true);
    expect(canTransitionDocumentStatus("uploaded", "processing")).toBe(true);
    expect(canTransitionDocumentStatus("processing", "ready")).toBe(true);
  });

  it("allows idempotent writes and controlled retries", () => {
    expect(canTransitionDocumentStatus("uploaded", "uploaded")).toBe(true);
    expect(canTransitionDocumentStatus("ready", "processing")).toBe(true);
    expect(canTransitionDocumentStatus("failed", "processing")).toBe(true);
  });

  it("rejects lifecycle skips and changes after deletion", () => {
    expect(canTransitionDocumentStatus("uploading", "ready")).toBe(false);
    expect(canTransitionDocumentStatus("uploaded", "ready")).toBe(false);
    expect(canTransitionDocumentStatus("deleted", "uploading")).toBe(false);
  });
});

describe("processing job status transitions", () => {
  it("exposes the exact Phase 2 lifecycle states", () => {
    expect(PROCESSING_JOB_STATUSES).toEqual([
      "pending",
      "processing",
      "completed",
      "failed",
      "retry",
    ]);
  });

  it("allows execution, completion, and retry", () => {
    expect(canTransitionProcessingJobStatus("pending", "processing")).toBe(true);
    expect(canTransitionProcessingJobStatus("processing", "completed")).toBe(true);
    expect(canTransitionProcessingJobStatus("processing", "failed")).toBe(true);
    expect(canTransitionProcessingJobStatus("failed", "retry")).toBe(true);
    expect(canTransitionProcessingJobStatus("retry", "pending")).toBe(true);
  });

  it("allows idempotent writes", () => {
    expect(canTransitionProcessingJobStatus("processing", "processing")).toBe(true);
  });

  it("keeps completed jobs terminal and rejects lifecycle skips", () => {
    expect(canTransitionProcessingJobStatus("completed", "processing")).toBe(false);
    expect(canTransitionProcessingJobStatus("pending", "completed")).toBe(false);
    expect(canTransitionProcessingJobStatus("processing", "retry")).toBe(false);
    expect(canTransitionProcessingJobStatus("failed", "pending")).toBe(false);
    expect(canTransitionProcessingJobStatus("retry", "processing")).toBe(false);
  });
});
