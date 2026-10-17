"use client";

import { authorizedFetch } from "@/infrastructure/supabase/browser-client";

interface InitUploadResponse {
  document: { id: string };
  upload: {
    bucket: string;
    path: string;
    token: string;
    signed_url: string;
  };
}

export interface CompleteUploadResponse {
  document: {
    id: string;
    status: "uploaded" | "processing" | "ready";
  };
  idempotent: boolean;
}

export class DocumentClientUploadError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DocumentClientUploadError";
  }
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function documentMimeType(file: File): string {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "pdf") {
    return "application/pdf";
  }

  if (extension === "md" || extension === "markdown") {
    return "text/markdown";
  }

  if (extension === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return file.type || "text/plain";
}

async function responseJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const responseBody = isRecord(body) ? body : undefined;
    const error = isRecord(responseBody?.error) ? responseBody.error : undefined;
    throw new DocumentClientUploadError(
      typeof error?.message === "string" ? error.message : "The document upload failed.",
      typeof error?.code === "string" ? error.code : "UPLOAD_FAILED",
      response.status,
    );
  }

  return body as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Browser upload pipeline: checksum -> init -> Storage -> complete. */
export async function uploadDocument(
  file: File,
  options?: { displayName?: string; knowledgeBaseId?: string; signal?: AbortSignal },
): Promise<CompleteUploadResponse> {
  const checksum = await sha256(file);
  const mimeType = documentMimeType(file);
  const initResponse = await authorizedFetch("/api/v1/documents/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      display_name: options?.displayName,
      knowledge_base_id: options?.knowledgeBaseId,
      filename: file.name,
      mime_type: mimeType,
      size_bytes: file.size,
      sha256: checksum,
    }),
    signal: options?.signal,
  });
  const initialized = await responseJson<InitUploadResponse>(initResponse);

  // Use the exact signed URL returned by the server. Rebuilding it from a
  // browser-side Supabase URL can silently target a different project in
  // Preview deployments. Supabase's browser uploadToSignedUrl implementation
  // sends File values as multipart form data; keep the same wire format for
  // signed upload endpoints while preserving the File's MIME type.
  const formData = new FormData();
  formData.append("cacheControl", "3600");
  formData.append("", file);

  let storageResponse: Response;
  try {
    storageResponse = await fetch(initialized.upload.signed_url, {
      method: "PUT",
      headers: { "x-upsert": "false" },
      body: formData,
      signal: options?.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Storage request failed.";
    console.error("Supabase Storage upload network error", {
      bucket: initialized.upload.bucket,
      path: initialized.upload.path,
      host: new URL(initialized.upload.signed_url).host,
      error: message,
    });
    throw new DocumentClientUploadError(message, "STORAGE_UPLOAD_NETWORK_FAILED", 0, {
      bucket: initialized.upload.bucket,
      path: initialized.upload.path,
      host: new URL(initialized.upload.signed_url).host,
    });
  }

  const storageBody = await storageResponse.text().catch(() => "");
  if (!storageResponse.ok) {
    console.error("Supabase Storage upload failed", {
      bucket: initialized.upload.bucket,
      path: initialized.upload.path,
      status: storageResponse.status,
      responseBody: storageBody,
    });
    throw new DocumentClientUploadError(
      `Storage upload failed (${storageResponse.status}): ${storageBody || "no response body"}`,
      "STORAGE_UPLOAD_FAILED",
      storageResponse.status,
      {
        bucket: initialized.upload.bucket,
        path: initialized.upload.path,
        responseBody: storageBody,
      },
    );
  }

  const completeResponse = await authorizedFetch(
    `/api/v1/documents/${encodeURIComponent(initialized.document.id)}/complete`,
    { method: "POST", signal: options?.signal },
  );

  return responseJson<CompleteUploadResponse>(completeResponse);
}
