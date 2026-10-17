import { describe, expect, it } from "vitest";

import { DocumentUploadError } from "@/features/documents/application/document-upload-error";
import { parseInitializeRequest } from "@/features/documents/http/document-upload-http";

describe("parseInitializeRequest", () => {
  it("maps the public snake-case contract to the application input", () => {
    expect(
      parseInitializeRequest({
        display_name: "Customer feedback",
        knowledge_base_id: "00000000-0000-4000-8000-000000000001",
        filename: "feedback.pdf",
        mime_type: "application/pdf",
        size_bytes: 1024,
        sha256: "a".repeat(64),
      }),
    ).toEqual({
      displayName: "Customer feedback",
      knowledgeBaseId: "00000000-0000-4000-8000-000000000001",
      filename: "feedback.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      sha256: "a".repeat(64),
    });
  });

  it("rejects malformed and unknown fields with structured validation details", () => {
    expect(() =>
      parseInitializeRequest({
        filename: "feedback.pdf",
        mime_type: "application/pdf",
        size_bytes: "1024",
        sha256: "a".repeat(64),
        unexpected: true,
      }),
    ).toThrowError(DocumentUploadError);

    try {
      parseInitializeRequest({ filename: "feedback.pdf" });
    } catch (error) {
      expect(error).toMatchObject({
        code: "INVALID_REQUEST",
        httpStatus: 400,
      });
      expect((error as DocumentUploadError).details?.issues).toBeInstanceOf(Array);
    }
  });
});
