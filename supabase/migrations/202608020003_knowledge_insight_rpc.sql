-- Novera AI Phase 1 Knowledge Insight Log writer.
-- This performs concurrency-safe aggregation only; it does not trigger learning.

begin;

create or replace function public.record_knowledge_insight(
  p_knowledge_base_id uuid,
  p_insight_type public.knowledge_insight_type,
  p_question_text text,
  p_normalized_question text,
  p_question_hash text,
  p_latest_qa_run_id uuid default null,
  p_confidence_score numeric default null,
  p_details jsonb default '{}'::jsonb
)
returns public.knowledge_insight_logs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  recorded public.knowledge_insight_logs;
begin
  insert into public.knowledge_insight_logs (
    knowledge_base_id,
    insight_type,
    question_text,
    normalized_question,
    question_hash,
    latest_qa_run_id,
    confidence_score,
    details
  )
  values (
    p_knowledge_base_id,
    p_insight_type,
    p_question_text,
    p_normalized_question,
    p_question_hash,
    p_latest_qa_run_id,
    p_confidence_score,
    coalesce(p_details, '{}'::jsonb)
  )
  on conflict (knowledge_base_id, insight_type, question_hash)
  do update set
    question_text = excluded.question_text,
    normalized_question = excluded.normalized_question,
    occurrence_count = public.knowledge_insight_logs.occurrence_count + 1,
    latest_qa_run_id = coalesce(
      excluded.latest_qa_run_id,
      public.knowledge_insight_logs.latest_qa_run_id
    ),
    confidence_score = coalesce(
      excluded.confidence_score,
      public.knowledge_insight_logs.confidence_score
    ),
    details = public.knowledge_insight_logs.details || excluded.details,
    last_observed_at = now()
  returning * into recorded;

  return recorded;
end;
$$;

comment on function public.record_knowledge_insight(
  uuid,
  public.knowledge_insight_type,
  text,
  text,
  text,
  uuid,
  numeric,
  jsonb
) is
  'Aggregates non-learning knowledge insight observations by normalized question fingerprint.';

revoke execute on function public.record_knowledge_insight(
  uuid,
  public.knowledge_insight_type,
  text,
  text,
  text,
  uuid,
  numeric,
  jsonb
) from public, anon, authenticated;

grant execute on function public.record_knowledge_insight(
  uuid,
  public.knowledge_insight_type,
  text,
  text,
  text,
  uuid,
  numeric,
  jsonb
) to service_role;

commit;
