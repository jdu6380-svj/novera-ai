-- Cover every foreign-key referencing column that was reported by the
-- Supabase performance advisor. These indexes reduce full-table scans during
-- joins and parent-row updates/deletes as the knowledge base grows.

create index if not exists chat_messages_qa_run_idx
  on public.chat_messages (qa_run_id);

create index if not exists evidence_items_chunk_document_idx
  on public.evidence_items (chunk_id, document_id);

create index if not exists evidence_items_claim_run_idx
  on public.evidence_items (claim_id, qa_run_id);

create index if not exists evidence_items_retrieval_run_idx
  on public.evidence_items (retrieval_result_id, qa_run_id);

create index if not exists knowledge_insight_logs_latest_qa_run_idx
  on public.knowledge_insight_logs (latest_qa_run_id);

create index if not exists qa_runs_assistant_message_idx
  on public.qa_runs (assistant_message_id);

create index if not exists qa_runs_user_message_idx
  on public.qa_runs (user_message_id);

create index if not exists retrieval_results_chunk_document_idx
  on public.retrieval_results (chunk_id, document_id);
