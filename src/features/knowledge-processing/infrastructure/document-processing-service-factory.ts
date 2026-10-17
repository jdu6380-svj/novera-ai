import "server-only";

import { getDocumentProcessingConfig } from "@/features/knowledge-processing/application/document-processing-config";
import { DocumentProcessingService } from "@/features/knowledge-processing/application/document-processing-service";
import { SupabaseDocumentProcessingRepository } from "@/features/knowledge-processing/infrastructure/supabase-document-processing-repository";
import { createLazyOpenAIEmbeddingProvider } from "@/infrastructure/ai";
import { SupabaseStorageAdapter } from "@/infrastructure/storage/supabase-storage-adapter";

let service: DocumentProcessingService | undefined;

export function getDocumentProcessingService(): DocumentProcessingService {
  if (!service) {
    service = new DocumentProcessingService(
      new SupabaseDocumentProcessingRepository(),
      new SupabaseStorageAdapter(),
      createLazyOpenAIEmbeddingProvider(),
      getDocumentProcessingConfig(),
    );
  }

  return service;
}

export async function runDocumentProcessingInBackground(
  jobId: string,
  traceId: string,
): Promise<void> {
  try {
    await getDocumentProcessingService().run(jobId);
  } catch (error) {
    console.error("Background document processing failed", {
      traceId,
      jobId,
      error,
    });
  }
}
