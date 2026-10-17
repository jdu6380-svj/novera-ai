-- Novera AI — Enterprise Knowledge Intelligence System
-- Phase 3: evidence-ready pgvector retrieval contract.

begin;

-- PostgreSQL cannot change a function's table return shape with CREATE OR
-- REPLACE, so replace the Phase 1 baseline while retaining its input contract.
drop function if exists public.match_document_chunks(
  extensions.vector,
  uuid,
  integer,
  double precision,
  uuid[]
);

create function public.match_document_chunks(
  query_embedding extensions.vector(1536),
  knowledge_base uuid,
  match_count integer default 8,
  similarity_threshold double precision default 0.35,
  filter_document_ids uuid[] default null
)
returns table (
  rank integer,
  chunk_id uuid,
  document_id uuid,
  document_name text,
  document_version integer,
  document_mime_type text,
  chunk_index integer,
  chunk_text text,
  token_count integer,
  page_start integer,
  page_end integer,
  start_char integer,
  end_char integer,
  section_path text,
  locator jsonb,
  similarity_score double precision,
  distance double precision,
  metadata jsonb,
  document_metadata jsonb,
  embedding_provider text,
  embedding_model text,
  embedding_model_version text,
  embedding_dimension integer,
  embedded_at timestamptz
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    (row_number() over (
      order by dc.embedding <=> query_embedding, dc.id
    ))::integer as rank,
    dc.id as chunk_id,
    d.id as document_id,
    d.display_name as document_name,
    d.version_no as document_version,
    d.mime_type as document_mime_type,
    dc.chunk_index,
    dc.text as chunk_text,
    dc.token_count,
    dc.page_start,
    dc.page_end,
    dc.start_char,
    dc.end_char,
    dc.section_path,
    jsonb_build_object(
      'pageStart', dc.page_start,
      'pageEnd', dc.page_end,
      'startChar', dc.start_char,
      'endChar', dc.end_char,
      'sectionPath', dc.section_path,
      'sourceSegments', case
        when jsonb_typeof(dc.metadata #> '{evidence,sourceSegments}') = 'array'
          then dc.metadata #> '{evidence,sourceSegments}'
        else '[]'::jsonb
      end
    ) as locator,
    1 - (dc.embedding <=> query_embedding) as similarity_score,
    dc.embedding <=> query_embedding as distance,
    dc.metadata,
    d.metadata as document_metadata,
    dc.embedding_provider,
    dc.embedding_model,
    dc.embedding_model_version,
    dc.embedding_dimension,
    dc.embedded_at
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where d.knowledge_base_id = knowledge_base
    and d.status = 'ready'
    and d.deleted_at is null
    and dc.embedding_status = 'ready'
    and dc.embedding is not null
    and dc.embedding_provider is not null
    and dc.embedding_model is not null
    and dc.embedding_model_version is not null
    and dc.embedding_dimension = 1536
    and dc.embedded_at is not null
    and (
      filter_document_ids is null
      or d.id = any(filter_document_ids)
    )
    and 1 - (dc.embedding <=> query_embedding) >= coalesce(similarity_threshold, 0.35)
  order by dc.embedding <=> query_embedding, dc.id
  limit greatest(1, least(coalesce(match_count, 8), 50));
$$;

comment on function public.match_document_chunks(
  extensions.vector,
  uuid,
  integer,
  double precision,
  uuid[]
) is
  'Returns ranked, evidence-ready chunks from ready documents with source locators and embedding provenance.';

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
