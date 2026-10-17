import "server-only";

import { ContextBuilder } from "@/features/retrieval/application/context-builder";
import { QueryUnderstandingLayer } from "@/features/retrieval/application/query-understanding";
import { RetrievalEngine } from "@/features/retrieval/application/retrieval-engine";
import { getRetrieverConfig } from "@/features/retrieval/application/retriever-config";
import { RetrieverService } from "@/features/retrieval/application/retriever-service";
import { SupabaseRetrievalRepository } from "@/features/retrieval/infrastructure/supabase-retrieval-repository";
import { createLazyOpenAIEmbeddingProvider } from "@/infrastructure/ai";

let engine: RetrievalEngine | undefined;

export function getRetrievalEngine(): RetrievalEngine {
  if (!engine) {
    const config = getRetrieverConfig();
    engine = new RetrievalEngine(
      new RetrieverService(
        new SupabaseRetrievalRepository(),
        createLazyOpenAIEmbeddingProvider(),
        config,
      ),
      new QueryUnderstandingLayer(),
      new ContextBuilder({ minimumSimilarity: config.defaultSimilarityThreshold }),
    );
  }

  return engine;
}
