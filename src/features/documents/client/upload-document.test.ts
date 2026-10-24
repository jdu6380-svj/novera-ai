import { beforeEach, describe, expect, it, vi } from "vitest";

import { authorizedFetch } from "@/infrastructure/supabase/browser-client";
import { uploadDocument } from "./upload-document";

vi.mock("@/infrastructure/supabase/browser-client", () => ({
  authorizedFetch: vi.fn(),
}));

const mockedAuthorizedFetch = vi.mocked(authorizedFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("uploadDocument", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockedAuthorizedFetch.mockReset();
  });

  it("sends DOCX as Supabase-compatible multipart form data", async () => {
    const file = new File(["docx bytes"], "测试文档.docx", {
      type: "application/octet-stream",
    });
    const signedUrl = "https://storage.example.test/object/upload/sign/knowledge-files/test?token=secret";

    mockedAuthorizedFetch
      .mockResolvedValueOnce(
        jsonResponse({
          document: { id: "00000000-0000-4000-8000-000000000010" },
          upload: {
            bucket: "knowledge-files",
            path: "knowledge-bases/test/documents/test/v1-test.docx",
            token: "secret",
            signed_url: signedUrl,
          },
        }, 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          document: { id: "00000000-0000-4000-8000-000000000010", status: "uploaded" },
          idempotent: false,
        }),
      );

    const storageFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 200 }));

    await uploadDocument(file);

    expect(storageFetch).toHaveBeenCalledWith(
      signedUrl,
      expect.objectContaining({
        method: "PUT",
        body: expect.any(FormData),
        headers: { "x-upsert": "false" },
      }),
    );
    const body = storageFetch.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect(body).toHaveProperty("get", expect.any(Function));
    expect((body as FormData).get("cacheControl")).toBe("3600");
    const uploadedFile = (body as FormData).get("");
    expect(uploadedFile).toBeInstanceOf(File);
    expect((uploadedFile as File).type).toBe(
      "application/octet-stream",
    );
    expect(mockedAuthorizedFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["chart.png", "image/png"],
    ["scan.jpeg", "image/jpeg"],
  ])("sends the correct OCR image MIME type for %s", async (filename, mimeType) => {
    const file = new File(["image bytes"], filename, { type: "application/octet-stream" });
    mockedAuthorizedFetch
      .mockResolvedValueOnce(jsonResponse({
        document: { id: "00000000-0000-4000-8000-000000000010" },
        upload: { bucket: "knowledge-files", path: "test/image", token: "token", signed_url: "https://storage.example.test/upload" },
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        document: { id: "00000000-0000-4000-8000-000000000010", status: "uploaded" },
        idempotent: false,
      }));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));

    await uploadDocument(file);

    const initBody = JSON.parse(String(mockedAuthorizedFetch.mock.calls[0]?.[1]?.body)) as { mime_type: string };
    expect(initBody.mime_type).toBe(mimeType);
  });
});
