-- Novera AI — Enterprise Knowledge Intelligence System
-- Phase 1 core schema: knowledge, ingestion, RAG traceability, and insight signals.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create type public.document_status as enum (
  'uploading',
  'uploaded',
  'processing',
  'ready',
  'failed',
  'deleting',
  'deleted'
);

create type public.document_processing_stage as enum (
  'upload',
  'parse',
  'chunk',
  'embed',
  'finalize'
);

create type public.processing_job_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
);

create type public.embedding_status as enum (
  'pending',
  'ready',
  'failed'
);

create type public.chat_role as enum (
  'user',
  'assistant',
  'system'
);

create type public.chat_message_status as enum (
  'pending',
  'processing',
  'completed',
  'failed'
);

create type public.task_type as enum (
  'auto',
  'qa',
  'summary',
  'analysis',
  'compare',
  'recommend'
);

create type public.qa_run_status as enum (
  'pending',
  'classifying',
  'retrieving',
  'generating',
  'verifying',
  'evaluating',
  'completed',
  'insufficient_evidence',
  'failed'
);

create type public.claim_support_status as enum (
  'full',
  'partial',
  'unsupported',
  'conflict'
);

create type public.feedback_rating as enum (
  'up',
  'down'
);

create type public.feedback_reason as enum (
  'incorrect',
  'incomplete',
  'unsupported',
  'irrelevant',
  'format_issue',
  'other'
);

create type public.knowledge_insight_type as enum (
  'frequent_question',
  'unanswered_question',
  'low_confidence_answer',
  'knowledge_gap'
);

create type public.knowledge_insight_status as enum (
  'open',
  'reviewed',
  'resolved',
  'ignored'
);

create table public.knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name varchar(120) not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_bases_slug_format_check
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

comment on table public.knowledge_bases is
  'Logical knowledge collections. Phase 1 uses a single default knowledge base.';

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete restrict,
  display_name text not null,
  original_filename text not null,
  mime_type text not null,
  file_extension text not null,
  storage_bucket text not null default 'knowledge-files',
  storage_path text not null unique,
  file_size_bytes bigint not null,
  sha256 char(64),
  version_no integer not null default 1,
  status public.document_status not null default 'uploading',
  processing_stage public.document_processing_stage,
  progress_pct smallint not null default 0,
  parser_name text,
  parser_version text,
  page_count integer,
  char_count integer,
  token_count integer,
  chunk_count integer not null default 0,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint documents_display_name_not_blank_check
    check (btrim(display_name) <> ''),
  constraint documents_original_filename_not_blank_check
    check (btrim(original_filename) <> ''),
  constraint documents_file_size_bytes_check
    check (file_size_bytes > 0),
  constraint documents_sha256_format_check
    check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint documents_version_no_check
    check (version_no >= 1),
  constraint documents_progress_pct_check
    check (progress_pct between 0 and 100),
  constraint documents_page_count_check
    check (page_count is null or page_count >= 0),
  constraint documents_char_count_check
    check (char_count is null or char_count >= 0),
  constraint documents_token_count_check
    check (token_count is null or token_count >= 0),
  constraint documents_chunk_count_check
    check (chunk_count >= 0)
);

comment on table public.documents is
  'Source-document metadata and ingestion lifecycle. Only ready documents are retrievable.';
comment on column public.documents.processing_stage is
  'Current pipeline stage; null while uploaded and waiting to be processed.';

create unique index documents_active_sha256_idx
  on public.documents (knowledge_base_id, sha256)
  where sha256 is not null and deleted_at is null;

create index documents_knowledge_base_status_idx
  on public.documents (knowledge_base_id, status, created_at desc);

create table public.document_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  stage public.document_processing_stage not null default 'parse',
  status public.processing_job_status not null default 'queued',
  attempt integer not null default 1,
  max_attempts integer not null default 2,
  progress_pct smallint not null default 0,
  idempotency_key text,
  config jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_processing_jobs_attempt_check
    check (attempt >= 1),
  constraint document_processing_jobs_max_attempts_check
    check (max_attempts >= 1 and attempt <= max_attempts),
  constraint document_processing_jobs_progress_pct_check
    check (progress_pct between 0 and 100)
);

comment on table public.document_processing_jobs is
  'Retryable, observable ingestion work for a document.';

create index document_processing_jobs_document_created_idx
  on public.document_processing_jobs (document_id, created_at desc);

create unique index document_processing_jobs_idempotency_idx
  on public.document_processing_jobs (document_id, idempotency_key)
  where idempotency_key is not null;

create unique index document_processing_jobs_one_active_idx
  on public.document_processing_jobs (document_id)
  where status in ('queued', 'running');

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index integer not null,
  text text not null,
  text_hash char(64) not null,
  token_count integer not null,
  page_start integer,
  page_end integer,
  start_char integer,
  end_char integer,
  section_path text,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(1536),
  embedding_model text,
  embedding_status public.embedding_status not null default 'pending',
  embedding_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_chunks_id_document_key
    unique (id, document_id),
  constraint document_chunks_document_chunk_index_key
    unique (document_id, chunk_index),
  constraint document_chunks_text_not_blank_check
    check (btrim(text) <> ''),
  constraint document_chunks_text_hash_format_check
    check (text_hash ~ '^[0-9a-f]{64}$'),
  constraint document_chunks_chunk_index_check
    check (chunk_index >= 0),
  constraint document_chunks_token_count_check
    check (token_count > 0),
  constraint document_chunks_page_range_check
    check (
      (page_start is null and page_end is null)
      or (
        page_start is not null
        and page_end is not null
        and page_start >= 1
        and page_end >= page_start
      )
    ),
  constraint document_chunks_char_range_check
    check (
      (start_char is null and end_char is null)
      or (
        start_char is not null
        and end_char is not null
        and start_char >= 0
        and end_char > start_char
      )
    ),
  constraint document_chunks_ready_embedding_check
    check (embedding_status <> 'ready' or embedding is not null)
);

comment on table public.document_chunks is
  'Normalized source chunks and embeddings. Embedding dimension is fixed to 1536 for the Phase 1 provider configuration.';

create index document_chunks_document_idx
  on public.document_chunks (document_id, chunk_index);

create index document_chunks_embedding_hnsw_idx
  on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  where embedding_status = 'ready';

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete restrict,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_knowledge_base_updated_idx
  on public.conversations (knowledge_base_id, updated_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role public.chat_role not null,
  content text not null,
  task_type public.task_type,
  status public.chat_message_status not null default 'completed',
  qa_run_id uuid,
  model text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  constraint chat_messages_content_not_blank_check
    check (btrim(content) <> '')
);

create index chat_messages_conversation_created_idx
  on public.chat_messages (conversation_id, created_at);

create table public.qa_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_message_id uuid not null references public.chat_messages(id) on delete cascade,
  assistant_message_id uuid references public.chat_messages(id) on delete set null,
  query text not null,
  requested_task_type public.task_type not null default 'auto',
  classified_task_type public.task_type,
  classifier_confidence numeric(5,4),
  task_understanding_details jsonb not null default '{}'::jsonb,
  status public.qa_run_status not null default 'pending',
  retrieval_config jsonb not null default '{}'::jsonb,
  answer_text text,
  model text,
  prompt_version text,
  retrieval_score numeric(5,2),
  evidence_coverage_score numeric(5,2),
  knowledge_match_score numeric(5,2),
  confidence_score numeric(5,2),
  metric_details jsonb not null default '{}'::jsonb,
  insufficient_reason text,
  error_code text,
  error_message text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qa_runs_query_not_blank_check
    check (btrim(query) <> ''),
  constraint qa_runs_classified_task_type_check
    check (classified_task_type is null or classified_task_type <> 'auto'),
  constraint qa_runs_classifier_confidence_check
    check (classifier_confidence is null or classifier_confidence between 0 and 1),
  constraint qa_runs_retrieval_score_check
    check (retrieval_score is null or retrieval_score between 0 and 100),
  constraint qa_runs_evidence_coverage_score_check
    check (evidence_coverage_score is null or evidence_coverage_score between 0 and 100),
  constraint qa_runs_knowledge_match_score_check
    check (knowledge_match_score is null or knowledge_match_score between 0 and 100),
  constraint qa_runs_confidence_score_check
    check (confidence_score is null or confidence_score between 0 and 100),
  constraint qa_runs_input_tokens_check
    check (input_tokens is null or input_tokens >= 0),
  constraint qa_runs_output_tokens_check
    check (output_tokens is null or output_tokens >= 0),
  constraint qa_runs_latency_ms_check
    check (latency_ms is null or latency_ms >= 0)
);

alter table public.chat_messages
  add constraint chat_messages_qa_run_id_fkey
  foreign key (qa_run_id) references public.qa_runs(id) on delete set null;

create index qa_runs_conversation_created_idx
  on public.qa_runs (conversation_id, created_at desc);

create index qa_runs_status_created_idx
  on public.qa_runs (status, created_at desc);

create table public.retrieval_results (
  id uuid primary key default gen_random_uuid(),
  qa_run_id uuid not null references public.qa_runs(id) on delete cascade,
  chunk_id uuid,
  document_id uuid references public.documents(id) on delete set null,
  rank smallint not null,
  distance double precision,
  relevance_score numeric(5,2) not null,
  selected boolean not null default true,
  document_name_snapshot text not null,
  chunk_text_snapshot text not null,
  locator_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint retrieval_results_chunk_document_fkey
    foreign key (chunk_id, document_id)
    references public.document_chunks(id, document_id)
    on delete set null (chunk_id),
  constraint retrieval_results_id_qa_run_key
    unique (id, qa_run_id),
  constraint retrieval_results_qa_run_rank_key
    unique (qa_run_id, rank),
  constraint retrieval_results_rank_check
    check (rank >= 1),
  constraint retrieval_results_relevance_score_check
    check (relevance_score between 0 and 100)
);

comment on table public.retrieval_results is
  'Ranked retrieval trace with immutable source snapshots for reproducibility.';

create index retrieval_results_qa_run_selected_idx
  on public.retrieval_results (qa_run_id, selected, rank);

create index retrieval_results_document_idx
  on public.retrieval_results (document_id, created_at desc);

create table public.answer_claims (
  id uuid primary key default gen_random_uuid(),
  qa_run_id uuid not null references public.qa_runs(id) on delete cascade,
  claim_index integer not null,
  claim_text text not null,
  claim_type text,
  weight numeric(6,3) not null default 1,
  support_status public.claim_support_status not null default 'unsupported',
  created_at timestamptz not null default now(),
  constraint answer_claims_id_qa_run_key
    unique (id, qa_run_id),
  constraint answer_claims_qa_run_claim_index_key
    unique (qa_run_id, claim_index),
  constraint answer_claims_claim_index_check
    check (claim_index >= 0),
  constraint answer_claims_claim_text_not_blank_check
    check (btrim(claim_text) <> ''),
  constraint answer_claims_weight_check
    check (weight > 0)
);

create index answer_claims_qa_run_support_idx
  on public.answer_claims (qa_run_id, support_status, claim_index);

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null,
  qa_run_id uuid not null references public.qa_runs(id) on delete cascade,
  retrieval_result_id uuid,
  chunk_id uuid,
  document_id uuid references public.documents(id) on delete set null,
  citation_label text not null,
  quote_text text not null,
  locator jsonb not null default '{}'::jsonb,
  support_score numeric(5,2),
  document_name_snapshot text not null,
  document_version_snapshot integer,
  created_at timestamptz not null default now(),
  constraint evidence_items_claim_run_fkey
    foreign key (claim_id, qa_run_id)
    references public.answer_claims(id, qa_run_id)
    on delete cascade,
  constraint evidence_items_retrieval_run_fkey
    foreign key (retrieval_result_id, qa_run_id)
    references public.retrieval_results(id, qa_run_id)
    on delete set null (retrieval_result_id),
  constraint evidence_items_chunk_document_fkey
    foreign key (chunk_id, document_id)
    references public.document_chunks(id, document_id)
    on delete set null (chunk_id),
  constraint evidence_items_citation_label_not_blank_check
    check (btrim(citation_label) <> ''),
  constraint evidence_items_quote_text_not_blank_check
    check (btrim(quote_text) <> ''),
  constraint evidence_items_support_score_check
    check (support_score is null or support_score between 0 and 100),
  constraint evidence_items_document_version_snapshot_check
    check (document_version_snapshot is null or document_version_snapshot >= 1)
);

comment on table public.evidence_items is
  'Claim-level source evidence. Snapshots preserve Answer -> Claim -> Evidence -> Source traceability after re-indexing.';

create index evidence_items_claim_idx
  on public.evidence_items (claim_id, citation_label);

create index evidence_items_qa_run_idx
  on public.evidence_items (qa_run_id, citation_label);

create index evidence_items_document_idx
  on public.evidence_items (document_id, created_at desc);

create table public.qa_feedback (
  id uuid primary key default gen_random_uuid(),
  qa_run_id uuid not null unique references public.qa_runs(id) on delete cascade,
  rating public.feedback_rating not null,
  reason public.feedback_reason,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.knowledge_insight_logs (
  id uuid primary key default gen_random_uuid(),
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
  insight_type public.knowledge_insight_type not null,
  status public.knowledge_insight_status not null default 'open',
  question_text text not null,
  normalized_question text not null,
  question_hash char(64) not null,
  occurrence_count integer not null default 1,
  latest_qa_run_id uuid references public.qa_runs(id) on delete set null,
  confidence_score numeric(5,2),
  details jsonb not null default '{}'::jsonb,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_insight_logs_question_text_not_blank_check
    check (btrim(question_text) <> ''),
  constraint knowledge_insight_logs_normalized_question_not_blank_check
    check (btrim(normalized_question) <> ''),
  constraint knowledge_insight_logs_question_hash_format_check
    check (question_hash ~ '^[0-9a-f]{64}$'),
  constraint knowledge_insight_logs_occurrence_count_check
    check (occurrence_count >= 1),
  constraint knowledge_insight_logs_confidence_score_check
    check (confidence_score is null or confidence_score between 0 and 100),
  constraint knowledge_insight_logs_observed_range_check
    check (last_observed_at >= first_observed_at),
  constraint knowledge_insight_logs_identity_key
    unique (knowledge_base_id, insight_type, question_hash)
);

comment on table public.knowledge_insight_logs is
  'Lightweight, non-learning signals for frequent questions, unanswered questions, low-confidence answers, and knowledge gaps.';

create index knowledge_insight_logs_type_status_idx
  on public.knowledge_insight_logs (
    knowledge_base_id,
    insight_type,
    status,
    occurrence_count desc,
    last_observed_at desc
  );

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.enforce_document_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  transition_allowed boolean := false;
begin
  if old.status = new.status then
    return new;
  end if;

  transition_allowed := case old.status
    when 'uploading' then new.status in ('uploaded', 'failed', 'deleting')
    when 'uploaded' then new.status in ('processing', 'failed', 'deleting')
    when 'processing' then new.status in ('ready', 'failed', 'deleting')
    when 'ready' then new.status in ('processing', 'deleting')
    when 'failed' then new.status in ('uploading', 'processing', 'deleting')
    when 'deleting' then new.status in ('deleted', 'failed')
    when 'deleted' then false
  end;

  if not transition_allowed then
    raise exception 'Invalid document status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_processing_job_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  transition_allowed boolean := false;
begin
  if old.status = new.status then
    return new;
  end if;

  transition_allowed := case old.status
    when 'queued' then new.status in ('running', 'failed', 'cancelled')
    when 'running' then new.status in ('succeeded', 'failed', 'cancelled')
    when 'succeeded' then false
    when 'failed' then new.status = 'queued'
    when 'cancelled' then new.status = 'queued'
  end;

  if not transition_allowed then
    raise exception 'Invalid processing job status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger knowledge_bases_set_updated_at
before update on public.knowledge_bases
for each row execute function public.set_updated_at();

create trigger documents_set_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

create trigger documents_enforce_status_transition
before update of status on public.documents
for each row execute function public.enforce_document_status_transition();

create trigger document_processing_jobs_set_updated_at
before update on public.document_processing_jobs
for each row execute function public.set_updated_at();

create trigger document_processing_jobs_enforce_status_transition
before update of status on public.document_processing_jobs
for each row execute function public.enforce_processing_job_status_transition();

create trigger document_chunks_set_updated_at
before update on public.document_chunks
for each row execute function public.set_updated_at();

create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

create trigger qa_runs_set_updated_at
before update on public.qa_runs
for each row execute function public.set_updated_at();

create trigger qa_feedback_set_updated_at
before update on public.qa_feedback
for each row execute function public.set_updated_at();

create trigger knowledge_insight_logs_set_updated_at
before update on public.knowledge_insight_logs
for each row execute function public.set_updated_at();

create or replace function public.match_document_chunks(
  query_embedding extensions.vector(1536),
  knowledge_base uuid,
  match_count integer default 8,
  similarity_threshold double precision default 0.35,
  filter_document_ids uuid[] default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_name text,
  chunk_index integer,
  chunk_text text,
  page_start integer,
  page_end integer,
  section_path text,
  similarity double precision,
  metadata jsonb
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    dc.id as chunk_id,
    d.id as document_id,
    d.display_name as document_name,
    dc.chunk_index,
    dc.text as chunk_text,
    dc.page_start,
    dc.page_end,
    dc.section_path,
    1 - (dc.embedding <=> query_embedding) as similarity,
    dc.metadata
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where d.knowledge_base_id = knowledge_base
    and d.status = 'ready'
    and d.deleted_at is null
    and dc.embedding_status = 'ready'
    and dc.embedding is not null
    and (
      filter_document_ids is null
      or d.id = any(filter_document_ids)
    )
    and 1 - (dc.embedding <=> query_embedding) >= similarity_threshold
  order by dc.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;

comment on function public.match_document_chunks is
  'Cosine-similarity retrieval scoped to ready source documents in one knowledge base.';

insert into public.knowledge_bases (id, slug, name, description)
values (
  '00000000-0000-4000-8000-000000000001',
  'default',
  'Novera AI Knowledge Base',
  'Default enterprise knowledge collection for the Novera AI MVP.'
)
on conflict (slug) do nothing;

-- The application accesses data through server-side Route Handlers with a service role.
-- RLS denies accidental direct browser access; service-role requests bypass these policies.
alter table public.knowledge_bases enable row level security;
alter table public.documents enable row level security;
alter table public.document_processing_jobs enable row level security;
alter table public.document_chunks enable row level security;
alter table public.conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.qa_runs enable row level security;
alter table public.retrieval_results enable row level security;
alter table public.answer_claims enable row level security;
alter table public.evidence_items enable row level security;
alter table public.qa_feedback enable row level security;
alter table public.knowledge_insight_logs enable row level security;

-- Supabase projects created with auto_expose_new_tables disabled do not grant
-- Data API access implicitly. Route Handlers use the service role; browser roles
-- intentionally receive no direct table access in this single-user MVP.
revoke all on table public.knowledge_bases from anon, authenticated;
revoke all on table public.documents from anon, authenticated;
revoke all on table public.document_processing_jobs from anon, authenticated;
revoke all on table public.document_chunks from anon, authenticated;
revoke all on table public.conversations from anon, authenticated;
revoke all on table public.chat_messages from anon, authenticated;
revoke all on table public.qa_runs from anon, authenticated;
revoke all on table public.retrieval_results from anon, authenticated;
revoke all on table public.answer_claims from anon, authenticated;
revoke all on table public.evidence_items from anon, authenticated;
revoke all on table public.qa_feedback from anon, authenticated;
revoke all on table public.knowledge_insight_logs from anon, authenticated;

grant usage on schema public to service_role;
grant usage on schema extensions to service_role;
grant select, insert, update, delete on table public.knowledge_bases to service_role;
grant select, insert, update, delete on table public.documents to service_role;
grant select, insert, update, delete on table public.document_processing_jobs to service_role;
grant select, insert, update, delete on table public.document_chunks to service_role;
grant select, insert, update, delete on table public.conversations to service_role;
grant select, insert, update, delete on table public.chat_messages to service_role;
grant select, insert, update, delete on table public.qa_runs to service_role;
grant select, insert, update, delete on table public.retrieval_results to service_role;
grant select, insert, update, delete on table public.answer_claims to service_role;
grant select, insert, update, delete on table public.evidence_items to service_role;
grant select, insert, update, delete on table public.qa_feedback to service_role;
grant select, insert, update, delete on table public.knowledge_insight_logs to service_role;

revoke execute on function public.match_document_chunks(
  extensions.vector,
  uuid,
  integer,
  double precision,
  uuid[]
) from public, anon, authenticated;

grant execute on function public.match_document_chunks(
  extensions.vector,
  uuid,
  integer,
  double precision,
  uuid[]
) to service_role;

commit;
