import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  JsonObject,
  KnowledgeInsightLog,
  KnowledgeInsightStatus,
  KnowledgeInsightType,
  RecordKnowledgeInsightInput,
} from "@/domain";
import { KnowledgeInsightError } from "@/features/knowledge-insights/application/knowledge-insight-error";
import type { KnowledgeInsightRepository } from "@/features/knowledge-insights/application/knowledge-insight-repository";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin-client";

interface KnowledgeInsightRow {
  id: string;
  knowledge_base_id: string;
  insight_type: KnowledgeInsightType;
  status: KnowledgeInsightStatus;
  question_text: string;
  normalized_question: string;
  question_hash: string;
  occurrence_count: number;
  latest_qa_run_id: string | null;
  confidence_score: number | string | null;
  details: JsonObject;
  first_observed_at: string;
  last_observed_at: string;
  created_at: string;
  updated_at: string;
}

function toKnowledgeInsight(row: KnowledgeInsightRow): KnowledgeInsightLog {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    insightType: row.insight_type,
    status: row.status,
    questionText: row.question_text,
    normalizedQuestion: row.normalized_question,
    questionHash: row.question_hash,
    occurrenceCount: row.occurrence_count,
    latestQaRunId: row.latest_qa_run_id,
    confidenceScore:
      row.confidence_score === null ? null : Number(row.confidence_score),
    details: row.details,
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseKnowledgeInsightRepository implements KnowledgeInsightRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseAdminClient()) {}

  async record(input: RecordKnowledgeInsightInput): Promise<KnowledgeInsightLog> {
    const { data, error } = await this.client.rpc("record_knowledge_insight", {
      p_knowledge_base_id: input.knowledgeBaseId,
      p_insight_type: input.insightType,
      p_question_text: input.questionText,
      p_normalized_question: input.normalizedQuestion,
      p_question_hash: input.questionHash,
      p_latest_qa_run_id: input.latestQaRunId ?? null,
      p_confidence_score: input.confidenceScore ?? null,
      p_details: input.details ?? {},
    });

    if (error || !data) {
      throw new KnowledgeInsightError(
        "The knowledge insight record could not be written.",
        "WRITE_FAILED",
        { cause: error },
      );
    }

    return toKnowledgeInsight(data as unknown as KnowledgeInsightRow);
  }
}
