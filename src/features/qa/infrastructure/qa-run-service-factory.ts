import "server-only";

import { getKnowledgeInsightService } from "@/features/knowledge-insights/infrastructure/knowledge-insight-service-factory";
import { getRetrievalEngine } from "@/features/retrieval/infrastructure/retrieval-engine-factory";
import { AnswerGenerator } from "@/features/qa/application/answer-generator";
import { ClaimExtractionLayer } from "@/features/qa/application/claim-extraction";
import { EvidenceVerificationLayer } from "@/features/qa/application/evidence-verifier";
import { QaRunService } from "@/features/qa/application/qa-run-service";
import { QualityEvaluator } from "@/features/qa/application/quality-evaluator";
import { SupabaseEvidenceSourceRepository } from "@/features/qa/infrastructure/supabase-evidence-source-repository";
import { SupabaseQaRunRepository } from "@/features/qa/infrastructure/supabase-qa-run-repository";
import {
  createLazyOpenAILanguageModelProvider,
  getLanguageModelIdentityConfig,
} from "@/infrastructure/ai";

let service: QaRunService | undefined;

export function getQaRunService(): QaRunService {
  if (!service) {
    const languageModelIdentity = getLanguageModelIdentityConfig();
    service = new QaRunService(
      getRetrievalEngine(),
      new AnswerGenerator(
        createLazyOpenAILanguageModelProvider(languageModelIdentity),
        new ClaimExtractionLayer(),
        languageModelIdentity.promptVersion,
      ),
      new EvidenceVerificationLayer(new SupabaseEvidenceSourceRepository()),
      new QualityEvaluator(),
      new SupabaseQaRunRepository(),
      getKnowledgeInsightService(),
    );
  }

  return service;
}
