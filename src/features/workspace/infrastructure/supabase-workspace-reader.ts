import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { UUID } from "@/domain";
import {
  buildWorkspaceData,
  type WorkspaceClaimRow,
  type WorkspaceDocumentRow,
  type WorkspaceEvidenceRow,
  type WorkspaceInsightRow,
  type WorkspaceKnowledgeBaseRow,
  type WorkspaceQaRunRow,
  type WorkspaceRetrievalRow,
} from "@/features/workspace/application/workspace-mapper";
import type { KnowledgeWorkspaceData } from "@/features/workspace/domain/workspace";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin-client";

export type WorkspaceReadErrorCode =
  | "KNOWLEDGE_BASE_NOT_FOUND"
  | "WORKSPACE_READ_FAILED";

export class WorkspaceReadError extends Error {
  constructor(
    message: string,
    readonly code: WorkspaceReadErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkspaceReadError";
  }
}

export interface WorkspaceReader {
  load(knowledgeBaseId: UUID): Promise<KnowledgeWorkspaceData>;
}

function readError(message: string, error: unknown): WorkspaceReadError {
  return new WorkspaceReadError(message, "WORKSPACE_READ_FAILED", { cause: error });
}

function ensureData<T>(
  data: T | null,
  error: unknown,
  message: string,
): T {
  if (error) throw readError(message, error);
  return data ?? ([] as T);
}

export class SupabaseWorkspaceReader implements WorkspaceReader {
  constructor(private readonly client: SupabaseClient = getSupabaseAdminClient()) {}

  async load(knowledgeBaseId: UUID): Promise<KnowledgeWorkspaceData> {
    const { data: knowledgeBase, error: knowledgeBaseError } = await this.client
      .from("knowledge_bases")
      .select("id,name,description")
      .eq("id", knowledgeBaseId)
      .maybeSingle();

    if (knowledgeBaseError) {
      throw readError("The knowledge workspace could not be loaded.", knowledgeBaseError);
    }

    if (!knowledgeBase) {
      throw new WorkspaceReadError(
        "The requested knowledge base was not found.",
        "KNOWLEDGE_BASE_NOT_FOUND",
      );
    }

    const [documentsResult, conversationsResult, insightsResult] = await Promise.all([
      this.client
        .from("documents")
        .select("id,display_name,file_extension,file_size_bytes,status,progress_pct,chunk_count,metadata,error_code,error_message,uploaded_at,created_at,updated_at")
        .eq("knowledge_base_id", knowledgeBaseId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(30),
      this.client
        .from("conversations")
        .select("id")
        .eq("knowledge_base_id", knowledgeBaseId),
      this.client
        .from("knowledge_insight_logs")
        .select("id,insight_type,question_text,occurrence_count,confidence_score,details,last_observed_at")
        .eq("knowledge_base_id", knowledgeBaseId)
        .order("occurrence_count", { ascending: false })
        .order("last_observed_at", { ascending: false })
        .limit(20),
    ]);

    const documents = ensureData<WorkspaceDocumentRow[]>(
      documentsResult.data as WorkspaceDocumentRow[] | null,
      documentsResult.error,
      "Workspace documents could not be loaded.",
    );
    const conversations = ensureData<Array<{ id: string }>>(
      conversationsResult.data as Array<{ id: string }> | null,
      conversationsResult.error,
      "Workspace conversations could not be loaded.",
    );
    const insights = ensureData<WorkspaceInsightRow[]>(
      insightsResult.data as WorkspaceInsightRow[] | null,
      insightsResult.error,
      "Knowledge insights could not be loaded.",
    );
    const conversationIds = conversations.map((conversation) => conversation.id);

    let qaRuns: WorkspaceQaRunRow[] = [];

    if (conversationIds.length > 0) {
      const { data, error } = await this.client
        .from("qa_runs")
        .select(
          "id,query,classified_task_type,requested_task_type,status,answer_payload,answer_text,metric_details,retrieval_score,evidence_coverage_score,knowledge_match_score,confidence_score,created_at",
        )
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false })
        .limit(12);

      qaRuns = ensureData<WorkspaceQaRunRow[]>(
        data as WorkspaceQaRunRow[] | null,
        error,
        "QA run history could not be loaded.",
      );
    }

    const runIds = qaRuns.map((run) => run.id);
    let claims: WorkspaceClaimRow[] = [];
    let evidence: WorkspaceEvidenceRow[] = [];
    let retrievalRows: WorkspaceRetrievalRow[] = [];
    const sourceDocumentIdsByRun = new Map<string, Set<string>>();

    if (runIds.length > 0) {
      const [claimsResult, evidenceResult, retrievalResult] = await Promise.all([
        this.client
          .from("answer_claims")
          .select("id,qa_run_id,claim_index,claim_text,claim_type,support_status")
          .in("qa_run_id", runIds)
          .order("claim_index", { ascending: true }),
        this.client
          .from("evidence_items")
          .select(
            "id,claim_id,qa_run_id,retrieval_result_id,document_id,citation_label,quote_text,locator,support_score,document_name_snapshot",
          )
          .in("qa_run_id", runIds)
          .order("created_at", { ascending: true }),
        this.client
          .from("retrieval_results")
          .select("id,relevance_score")
          .in("qa_run_id", runIds),
      ]);

      claims = ensureData<WorkspaceClaimRow[]>(
        claimsResult.data as WorkspaceClaimRow[] | null,
        claimsResult.error,
        "QA claims could not be loaded.",
      );
      evidence = ensureData<WorkspaceEvidenceRow[]>(
        evidenceResult.data as WorkspaceEvidenceRow[] | null,
        evidenceResult.error,
        "QA evidence could not be loaded.",
      );
      retrievalRows = ensureData<WorkspaceRetrievalRow[]>(
        retrievalResult.data as WorkspaceRetrievalRow[] | null,
        retrievalResult.error,
        "QA retrieval traces could not be loaded.",
      );

      for (const item of evidence) {
        if (!item.document_id) continue;
        const documentsForRun = sourceDocumentIdsByRun.get(item.qa_run_id) ?? new Set<string>();
        documentsForRun.add(item.document_id);
        sourceDocumentIdsByRun.set(item.qa_run_id, documentsForRun);
      }
    }

    return buildWorkspaceData({
      knowledgeBase: knowledgeBase as WorkspaceKnowledgeBaseRow,
      documents,
      qaRuns,
      claims,
      evidence,
      retrievalRows,
      insights,
      sourceDocumentIdsByRun,
      now: new Date(),
    });
  }
}
