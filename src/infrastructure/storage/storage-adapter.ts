export interface CreateSignedUploadInput {
  bucket: string;
  path: string;
  upsert?: boolean;
}

export interface SignedUpload {
  bucket: string;
  path: string;
  token: string;
  signedUrl: string;
  expiresInSeconds: number;
}

export interface SignedDownload {
  signedUrl: string;
  expiresInSeconds: number;
}

export interface StorageObjectMetadata {
  exists: boolean;
  sizeBytes: number | null;
  contentType: string | null;
}

export interface DownloadedStorageObject {
  data: Uint8Array;
  sizeBytes: number;
  contentType: string | null;
}

export interface StorageAdapter {
  createSignedUpload(input: CreateSignedUploadInput): Promise<SignedUpload>;
  createSignedDownload(bucket: string, path: string, expiresInSeconds: number): Promise<SignedDownload>;
  getObjectMetadata(bucket: string, path: string): Promise<StorageObjectMetadata>;
  downloadObject(bucket: string, path: string): Promise<DownloadedStorageObject>;
  removeObject(bucket: string, path: string): Promise<void>;
}
