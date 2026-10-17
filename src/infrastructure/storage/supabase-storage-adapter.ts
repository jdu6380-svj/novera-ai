import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin-client";
import type {
  CreateSignedUploadInput,
  DownloadedStorageObject,
  SignedDownload,
  SignedUpload,
  StorageAdapter,
  StorageObjectMetadata,
} from "@/infrastructure/storage/storage-adapter";
import { SIGNED_UPLOAD_TTL_SECONDS } from "@/infrastructure/storage/storage-config";
import { StorageError } from "@/infrastructure/storage/storage-error";

function splitObjectPath(path: string): { directory: string; filename: string } {
  const separator = path.lastIndexOf("/");

  if (separator === -1) {
    return { directory: "", filename: path };
  }

  return {
    directory: path.slice(0, separator),
    filename: path.slice(separator + 1),
  };
}

export class SupabaseStorageAdapter implements StorageAdapter {
  constructor(private readonly client: SupabaseClient = getSupabaseAdminClient()) {}

  async createSignedUpload(input: CreateSignedUploadInput): Promise<SignedUpload> {
    const { data, error } = await this.client.storage
      .from(input.bucket)
      .createSignedUploadUrl(input.path, { upsert: input.upsert ?? false });

    if (error || !data?.signedUrl || !data.token) {
      throw new StorageError(
        "Could not create a signed document upload URL.",
        "SIGNED_UPLOAD_CREATE_FAILED",
        { cause: error },
      );
    }

    return {
      bucket: input.bucket,
      path: data.path ?? input.path,
      token: data.token,
      signedUrl: data.signedUrl,
      expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
    };
  }

  async createSignedDownload(
    bucket: string,
    path: string,
    expiresInSeconds: number,
  ): Promise<SignedDownload> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds, { download: false });
    if (error || !data?.signedUrl) {
      throw new StorageError("Could not create a document preview URL.", "SIGNED_DOWNLOAD_CREATE_FAILED", {
        cause: error,
      });
    }
    return { signedUrl: data.signedUrl, expiresInSeconds };
  }

  async getObjectMetadata(bucket: string, path: string): Promise<StorageObjectMetadata> {
    const { directory, filename } = splitObjectPath(path);
    const { data, error } = await this.client.storage.from(bucket).list(directory, {
      limit: 100,
      search: filename,
    });

    if (error) {
      throw new StorageError("Could not verify the uploaded document.", "OBJECT_LOOKUP_FAILED", {
        cause: error,
      });
    }

    const object = data.find((item) => item.name === filename);

    if (!object) {
      return { exists: false, sizeBytes: null, contentType: null };
    }

    const size = object.metadata?.size;
    const contentType = object.metadata?.mimetype ?? object.metadata?.contentType;

    return {
      exists: true,
      sizeBytes: typeof size === "number" ? size : null,
      contentType: typeof contentType === "string" ? contentType : null,
    };
  }

  async downloadObject(bucket: string, path: string): Promise<DownloadedStorageObject> {
    const { data, error } = await this.client.storage.from(bucket).download(path);

    if (error || !data) {
      throw new StorageError("Could not download the document.", "OBJECT_DOWNLOAD_FAILED", {
        cause: error,
      });
    }

    const bytes = new Uint8Array(await data.arrayBuffer());

    return {
      data: bytes,
      sizeBytes: bytes.byteLength,
      contentType: data.type || null,
    };
  }

  async removeObject(bucket: string, path: string): Promise<void> {
    const { error } = await this.client.storage.from(bucket).remove([path]);

    if (error) {
      throw new StorageError("Could not remove the document from storage.", "OBJECT_DELETE_FAILED", {
        cause: error,
      });
    }
  }
}
