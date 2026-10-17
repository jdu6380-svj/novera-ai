import "server-only";

import { KnowledgeInsightService } from "@/features/knowledge-insights/application/knowledge-insight-service";
import { SupabaseKnowledgeInsightRepository } from "@/features/knowledge-insights/infrastructure/supabase-knowledge-insight-repository";

let service: KnowledgeInsightService | undefined;

export function getKnowledgeInsightService(): KnowledgeInsightService {
  if (!service) {
    service = new KnowledgeInsightService(new SupabaseKnowledgeInsightRepository());
  }

  return service;
}
