-- Novera AI — Enterprise Knowledge Intelligence System
-- Phase 2 atomic processing lifecycle operations.

begin;

create or replace function public.claim_document_processing_job(
  p_job_id uuid,
  p_started_at timestamptz default now()
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  processing_job public.document_processing_jobs;
  source_document public.documents;
begin
  select *
  into processing_job
  from public.document_processing_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Processing job not found: %', p_job_id
      using errcode = 'P0002';
  end if;

  if processing_job.status = 'processing' then
    return false;
  end if;

  if processing_job.status <> 'pending' then
    raise exception 'Processing job cannot be claimed from status: %', processing_job.status
      using errcode = '23514';
  end if;

  select *
  into source_document
  from public.documents
  where id = processing_job.document_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Source document not found: %', processing_job.document_id
      using errcode = 'P0002';
  end if;

  if source_document.status not in ('uploaded', 'failed') then
    raise exception 'Document cannot enter processing from status: %', source_document.status
      using errcode = '23514';
  end if;

  update public.document_processing_jobs
  set
    status = 'processing',
    stage = 'parse',
    progress_pct = 5,
    started_at = coalesce(started_at, p_started_at),
    finished_at = null,
    error_code = null,
    error_message = null
  where id = processing_job.id;

  update public.documents
  set
    status = 'processing',
    processing_stage = 'parse',
    progress_pct = 5,
    processed_at = null,
    error_code = null,
    error_message = null
  where id = source_document.id;

  return true;
end;
$$;

comment on function public.claim_document_processing_job(uuid, timestamptz) is
  'Atomically claims a pending ingestion job and moves its source document into processing.';

create or replace function public.finalize_document_processing_job(
  p_job_id uuid,
  p_parser_name text,
  p_parser_version text,
  p_page_count integer,
  p_char_count integer,
  p_token_count integer,
  p_processing_metadata jsonb,
  p_chunks jsonb,
  p_completed_at timestamptz default now()
)
returns boolean
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  processing_job public.document_processing_jobs;
  source_document public.documents;
  chunk jsonb;
  expected_chunk_count integer;
  inserted_chunk_count integer;
begin
  if jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'p_chunks must be a JSON array'
      using errcode = '22023';
  end if;

  expected_chunk_count := jsonb_array_length(p_chunks);

  if expected_chunk_count < 1 then
    raise exception 'At least one chunk is required to finalize a document'
      using errcode = '22023';
  end if;

  select *
  into processing_job
  from public.document_processing_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Processing job not found: %', p_job_id
      using errcode = 'P0002';
  end if;

  if processing_job.status = 'completed' then
    return false;
  end if;

  if processing_job.status <> 'processing' then
    raise exception 'Processing job cannot be finalized from status: %', processing_job.status
      using errcode = '23514';
  end if;

  select *
  into source_document
  from public.documents
  where id = processing_job.document_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Source document not found: %', processing_job.document_id
      using errcode = 'P0002';
  end if;

  if source_document.status <> 'processing' then
    raise exception 'Document cannot be finalized from status: %', source_document.status
      using errcode = '23514';
  end if;

  delete from public.document_chunks
  where document_id = source_document.id;

  for chunk in
    select value from jsonb_array_elements(p_chunks)
  loop
    insert into public.document_chunks (
      document_id,
      chunk_index,
      text,
      text_hash,
      token_count,
      page_start,
      page_end,
      start_char,
      end_char,
      section_path,
      metadata,
      embedding,
      embedding_provider,
      embedding_model,
      embedding_model_version,
      embedding_dimension,
      embedded_at,
      embedding_status,
      embedding_error
    )
    values (
      source_document.id,
      (chunk ->> 'chunk_index')::integer,
      chunk ->> 'text',
      chunk ->> 'text_hash',
      (chunk ->> 'token_count')::integer,
      nullif(chunk ->> 'page_start', '')::integer,
      nullif(chunk ->> 'page_end', '')::integer,
      nullif(chunk ->> 'start_char', '')::integer,
      nullif(chunk ->> 'end_char', '')::integer,
      nullif(chunk ->> 'section_path', ''),
      coalesce(chunk -> 'metadata', '{}'::jsonb),
      ((chunk -> 'embedding')::text)::extensions.vector(1536),
      chunk ->> 'embedding_provider',
      chunk ->> 'embedding_model',
      chunk ->> 'embedding_model_version',
      (chunk ->> 'embedding_dimension')::integer,
      (chunk ->> 'embedded_at')::timestamptz,
      'ready',
      null
    );
  end loop;

  get diagnostics inserted_chunk_count = row_count;

  -- ROW_COUNT only reflects the final statement inside a PL/pgSQL loop, so
  -- verify the persisted set explicitly before publishing the document.
  select count(*)
  into inserted_chunk_count
  from public.document_chunks
  where document_id = source_document.id;

  if inserted_chunk_count <> expected_chunk_count then
    raise exception 'Chunk persistence mismatch: expected %, inserted %',
      expected_chunk_count,
      inserted_chunk_count
      using errcode = '23514';
  end if;

  update public.documents
  set
    status = 'ready',
    processing_stage = 'finalize',
    progress_pct = 100,
    parser_name = p_parser_name,
    parser_version = p_parser_version,
    page_count = p_page_count,
    char_count = p_char_count,
    token_count = p_token_count,
    chunk_count = expected_chunk_count,
    metadata = source_document.metadata || jsonb_build_object(
      'processing',
      coalesce(p_processing_metadata, '{}'::jsonb)
    ),
    processed_at = p_completed_at,
    error_code = null,
    error_message = null
  where id = source_document.id;

  update public.document_processing_jobs
  set
    status = 'completed',
    stage = 'finalize',
    progress_pct = 100,
    finished_at = p_completed_at,
    error_code = null,
    error_message = null
  where id = processing_job.id;

  return true;
end;
$$;

comment on function public.finalize_document_processing_job(
  uuid,
  text,
  text,
  integer,
  integer,
  integer,
  jsonb,
  jsonb,
  timestamptz
) is
  'Atomically replaces source chunks, stores embedding provenance, and publishes the document as ready.';

create or replace function public.fail_document_processing_job(
  p_job_id uuid,
  p_error_code text,
  p_error_message text,
  p_failed_at timestamptz default now()
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  processing_job public.document_processing_jobs;
begin
  select *
  into processing_job
  from public.document_processing_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Processing job not found: %', p_job_id
      using errcode = 'P0002';
  end if;

  if processing_job.status = 'failed' then
    return false;
  end if;

  if processing_job.status <> 'processing' then
    raise exception 'Processing job cannot fail from status: %', processing_job.status
      using errcode = '23514';
  end if;

  update public.document_processing_jobs
  set
    status = 'failed',
    error_code = p_error_code,
    error_message = p_error_message,
    finished_at = p_failed_at
  where id = processing_job.id;

  update public.documents
  set
    status = 'failed',
    error_code = p_error_code,
    error_message = p_error_message
  where id = processing_job.document_id
    and status = 'processing';

  return true;
end;
$$;

comment on function public.fail_document_processing_job(uuid, text, text, timestamptz) is
  'Atomically records a processing failure on the job and source document.';

revoke execute on function public.claim_document_processing_job(uuid, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.finalize_document_processing_job(
  uuid,
  text,
  text,
  integer,
  integer,
  integer,
  jsonb,
  jsonb,
  timestamptz
) from public, anon, authenticated;
revoke execute on function public.fail_document_processing_job(uuid, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.claim_document_processing_job(uuid, timestamptz)
  to service_role;
grant execute on function public.finalize_document_processing_job(
  uuid,
  text,
  text,
  integer,
  integer,
  integer,
  jsonb,
  jsonb,
  timestamptz
) to service_role;
grant execute on function public.fail_document_processing_job(uuid, text, text, timestamptz)
  to service_role;

commit;
