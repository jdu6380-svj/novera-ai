import "server-only";

import { DocumentUploadService } from "@/features/documents/application/document-upload-service";
import { SupabaseDocumentUploadRepository } from "@/features/documents/infrastructure/supabase-document-upload-repository";
import { SupabaseStorageAdapter } from "@/infrastructure/storage/supabase-storage-adapter";

let service: DocumentUploadService | undefined;

export function getDocumentUploadService(): DocumentUploadService {
  if (!service) {
    service = new DocumentUploadService(
      new SupabaseDocumentUploadRepository(),
      new SupabaseStorageAdapter(),
    );
  }

  return service;
}
