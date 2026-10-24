const MEBIBYTE = 1024 * 1024;

export const DEFAULT_STORAGE_BUCKET = "knowledge-files";
export const DEFAULT_MAX_DOCUMENT_SIZE_BYTES = 20 * MEBIBYTE;
export const SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60;

export const SUPPORTED_DOCUMENT_TYPES = {
  pdf: ["application/pdf"],
  md: ["text/markdown", "text/plain"],
  markdown: ["text/markdown", "text/plain"],
  txt: ["text/plain"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
} as const satisfies Record<string, readonly string[]>;

export type SupportedDocumentExtension = keyof typeof SUPPORTED_DOCUMENT_TYPES;

export interface StorageConfig {
  bucket: string;
  maxDocumentSizeBytes: number;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getStorageConfig(): StorageConfig {
  return {
    bucket: process.env.SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_STORAGE_BUCKET,
    maxDocumentSizeBytes: parsePositiveInteger(
      process.env.MAX_DOCUMENT_SIZE_BYTES,
      DEFAULT_MAX_DOCUMENT_SIZE_BYTES,
    ),
  };
}

export function isSupportedDocumentType(extension: string, mimeType: string): boolean {
  const allowedMimeTypes = SUPPORTED_DOCUMENT_TYPES[
    extension.toLowerCase() as SupportedDocumentExtension
  ] as readonly string[] | undefined;

  return Boolean(allowedMimeTypes?.includes(mimeType));
}
