-- Novera AI — Enterprise Knowledge Intelligence System
-- Phase 2: processing-job lifecycle and embedding provenance.

begin;

-- Rename enum labels in place so existing rows retain their enum OIDs while
-- the public lifecycle matches the Phase 2 processing contract.
drop index if exists public.document_processing_jobs_one_active_idx;

alter table public.document_processing_jobs
  alter column status drop default;

alter type public.processing_job_status rename value 'queued' to 'pending';
alter type public.processing_job_status rename value 'running' to 'processing';
alter type public.processing_job_status rename value 'succeeded' to 'completed';
alter type public.processing_job_status rename value 'cancelled' to 'retry';

alter table public.document_processing_jobs
  alter column status set default 'pending';

create unique index document_processing_jobs_one_active_idx
  on public.document_processing_jobs (document_id)
  where status in ('pending', 'processing');

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
    when 'pending' then new.status = 'processing'
    when 'processing' then new.status in ('completed', 'failed')
    when 'completed' then false
    when 'failed' then new.status = 'retry'
    when 'retry' then new.status = 'pending'
  end;

  if not transition_allowed then
    raise exception 'Invalid processing job status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on type public.processing_job_status is
  'Phase 2 ingestion job lifecycle: pending -> processing -> completed, with failed -> retry -> pending.';

alter table public.document_chunks
  add column embedding_provider text,
  add column embedding_model_version text,
  add column embedding_dimension integer,
  add column embedded_at timestamptz;

-- Phase 1 only required a vector for ready chunks. Preserve any such rows and
-- label unknown provenance explicitly before enforcing the Phase 2 contract.
update public.document_chunks
set
  embedding_provider = coalesce(nullif(btrim(embedding_provider), ''), 'legacy-unknown'),
  embedding_model = coalesce(nullif(btrim(embedding_model), ''), 'legacy-unknown'),
  embedding_model_version = coalesce(nullif(btrim(embedding_model_version), ''), 'legacy-unknown'),
  embedding_dimension = coalesce(embedding_dimension, 1536),
  embedded_at = coalesce(embedded_at, updated_at, created_at),
  embedding_error = null
where embedding_status = 'ready';

alter table public.document_chunks
  drop constraint document_chunks_ready_embedding_check,
  add constraint document_chunks_embedding_provider_not_blank_check
    check (embedding_provider is null or btrim(embedding_provider) <> ''),
  add constraint document_chunks_embedding_model_not_blank_check
    check (embedding_model is null or btrim(embedding_model) <> ''),
  add constraint document_chunks_embedding_model_version_not_blank_check
    check (embedding_model_version is null or btrim(embedding_model_version) <> ''),
  add constraint document_chunks_embedding_dimension_check
    check (embedding_dimension is null or embedding_dimension = 1536),
  add constraint document_chunks_ready_embedding_check
    check (
      embedding_status <> 'ready'
      or (
        embedding is not null
        and embedding_provider is not null
        and embedding_model is not null
        and embedding_model_version is not null
        and embedding_dimension = 1536
        and embedded_at is not null
        and embedding_error is null
      )
    );

comment on column public.document_chunks.embedding_provider is
  'Provider adapter that produced the stored embedding.';
comment on column public.document_chunks.embedding_model is
  'Embedding model identifier reported by the provider.';
comment on column public.document_chunks.embedding_model_version is
  'Pinned model or deployment version used to make the embedding reproducible.';
comment on column public.document_chunks.embedding_dimension is
  'Recorded vector dimension. Phase 2 storage is fixed to 1536 dimensions.';
comment on column public.document_chunks.embedded_at is
  'Timestamp when the chunk embedding was successfully produced.';

commit;
