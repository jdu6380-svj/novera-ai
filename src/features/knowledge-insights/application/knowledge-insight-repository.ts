import type {
  KnowledgeInsightLog,
  RecordKnowledgeInsightInput,
} from "@/domain";

export interface KnowledgeInsightRepository {
  record(input: RecordKnowledgeInsightInput): Promise<KnowledgeInsightLog>;
}
