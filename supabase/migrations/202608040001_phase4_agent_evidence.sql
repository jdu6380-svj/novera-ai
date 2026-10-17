-- Novera AI Phase 4: structured answers, claim-level evidence, and atomic QA persistence.

begin;

alter table public.qa_runs
  add column if not exists answer_payload jsonb not null default '{}'::jsonb;

comment on column public.qa_runs.answer_payload is
  'Structured Answer Generator output, including claims, limitations, and insufficient_evidence.';

create or replace function public.enforce_qa_run_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status not in ('classifying', 'failed') then
    raise exception 'Invalid QA run status transition: % -> %', old.status, new.status;
  elsif old.status = 'classifying' and new.status not in ('retrieving', 'failed') then
    raise exception 'Invalid QA run status transition: % -> %', old.status, new.status;
  elsif old.status = 'retrieving' and new.status not in ('generating', 'failed') then
    raise exception 'Invalid QA run status transition: % -> %', old.status, new.status;
  elsif old.status = 'generating' and new.status not in ('verifying', 'failed') then
    raise exception 'Invalid QA run status transition: % -> %', old.status, new.status;
  elsif old.status = 'verifying' and new.status not in ('evaluating', 'failed') then
    raise exception 'Invalid QA run status transition: % -> %', old.status, new.status;
  elsif old.status = 'evaluating'
    and new.status not in ('completed', 'insufficient_evidence', 'failed') then
    raise exception 'Invalid QA run status transition: % -> %', old.status, new.status;
  elsif old.status in ('completed', 'insufficient_evidence', 'failed') then
    raise exception 'Terminal QA run status cannot transition: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists qa_runs_enforce_status_transition on public.qa_runs;
create trigger qa_runs_enforce_status_transition
before update of status on public.qa_runs
for each row
when (old.status is distinct from new.status)
execute function public.enforce_qa_run_status_transition();

create or replace function public.start_qa_run(
  p_knowledge_base_id uuid,
  p_query text,
  p_requested_task_type public.task_type default 'auto',
  p_conversation_id uuid default null
)
returns table (
  qa_run_id uuid,
  conversation_id uuid,
  user_message_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_conversation_id uuid;
  resolved_user_message_id uuid;
  resolved_qa_run_id uuid;
begin
  if btrim(coalesce(p_query, '')) = '' then
    raise exception using errcode = '22023', message = 'A non-empty query is required.';
  end if;

  if p_conversation_id is not null then
    select c.id
      into resolved_conversation_id
      from public.conversations c
     where c.id = p_conversation_id
       and c.knowledge_base_id = p_knowledge_base_id;

    if resolved_conversation_id is null then
      raise exception using errcode = '22023', message = 'Conversation does not belong to the knowledge base.';
    end if;
  else
    insert into public.conversations (knowledge_base_id, title)
    values (p_knowledge_base_id, left(btrim(p_query), 120))
    returning id into resolved_conversation_id;
  end if;

  insert into public.chat_messages (
    conversation_id,
    role,
    content,
    task_type,
    status
  )
  values (
    resolved_conversation_id,
    'user',
    btrim(p_query),
    p_requested_task_type,
    'processing'
  )
  returning id into resolved_user_message_id;

  insert into public.qa_runs (
    conversation_id,
    user_message_id,
    query,
    requested_task_type,
    status,
    started_at
  )
  values (
    resolved_conversation_id,
    resolved_user_message_id,
    btrim(p_query),
    p_requested_task_type,
    'pending',
    now()
  )
  returning id into resolved_qa_run_id;

  return query select
    resolved_qa_run_id,
    resolved_conversation_id,
    resolved_user_message_id;
end;
$$;

create or replace function public.set_qa_run_status(
  p_qa_run_id uuid,
  p_status public.qa_run_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.qa_runs
     set status = p_status
   where id = p_qa_run_id
     and status not in ('completed', 'insufficient_evidence', 'failed');

  if not found then
    raise exception using errcode = 'P0002', message = 'QA run was not found or is already terminal.';
  end if;
end;
$$;

create or replace function public.complete_qa_run(
  p_qa_run_id uuid,
  p_requested_task_type public.task_type,
  p_classified_task_type public.task_type,
  p_classifier_confidence numeric,
  p_task_understanding_details jsonb,
  p_retrieval_config jsonb,
  p_answer_payload jsonb,
  p_retrieval_rows jsonb,
  p_claim_rows jsonb,
  p_evidence_rows jsonb,
  p_metrics jsonb,
  p_status public.qa_run_status,
  p_model text,
  p_prompt_version text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_latency_ms integer,
  p_insufficient_reason text
)
returns table (assistant_message_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  run_conversation_id uuid;
  run_user_message_id uuid;
  run_knowledge_base_id uuid;
  resolved_assistant_message_id uuid;
begin
  select qr.conversation_id, qr.user_message_id, c.knowledge_base_id
    into run_conversation_id, run_user_message_id, run_knowledge_base_id
    from public.qa_runs qr
    join public.conversations c on c.id = qr.conversation_id
   where qr.id = p_qa_run_id
   for update;

  if run_conversation_id is null then
    raise exception using errcode = 'P0002', message = 'QA run was not found.';
  end if;

  if p_status not in ('completed', 'insufficient_evidence') then
    raise exception using errcode = '22023', message = 'QA completion requires a terminal success status.';
  end if;

  if p_classified_task_type = 'auto' then
    raise exception using errcode = '22023', message = 'Classified task type cannot be auto.';
  end if;

  -- Revalidate every immutable retrieval snapshot against a READY source before writing evidence.
  if exists (
    select 1
      from jsonb_to_recordset(coalesce(p_retrieval_rows, '[]'::jsonb)) as rr(
        chunk_id uuid,
        document_id uuid,
        rank integer,
        distance double precision,
        relevance_score numeric,
        selected boolean,
        document_name_snapshot text,
        chunk_text_snapshot text,
        locator_snapshot jsonb
      )
      left join public.document_chunks dc
        on dc.id = rr.chunk_id and dc.document_id = rr.document_id
      left join public.documents d on d.id = rr.document_id
     where dc.id is null
        or d.id is null
        or d.knowledge_base_id <> run_knowledge_base_id
        or d.status <> 'ready'
        or d.deleted_at is not null
        or d.display_name <> rr.document_name_snapshot
        or dc.text <> rr.chunk_text_snapshot
  ) then
    raise exception using errcode = 'P0001', message = 'A retrieval snapshot no longer belongs to a READY source document.';
  end if;

  -- Revalidate claim evidence against the same retrieval set and current database text.
  if exists (
    select 1
      from jsonb_to_recordset(coalesce(p_evidence_rows, '[]'::jsonb)) as ev(
        claim_index integer,
        citation_label text,
        quote_text text,
        chunk_id uuid,
        document_id uuid,
        locator jsonb,
        support_score numeric,
        document_name_snapshot text,
        document_version_snapshot integer
      )
     where not exists (
       select 1
         from jsonb_to_recordset(coalesce(p_retrieval_rows, '[]'::jsonb)) as rr(
           chunk_id uuid,
           document_id uuid,
           rank integer,
           distance double precision,
           relevance_score numeric,
           selected boolean,
           document_name_snapshot text,
           chunk_text_snapshot text,
           locator_snapshot jsonb
         )
        where rr.chunk_id = ev.chunk_id
          and rr.document_id = ev.document_id
          and coalesce(rr.selected, false)
          and rr.locator_snapshot ->> 'citation_label' = ev.citation_label
     )
        or not exists (
       select 1
         from public.document_chunks dc
         join public.documents d on d.id = dc.document_id
        where dc.id = ev.chunk_id
          and dc.document_id = ev.document_id
          and d.knowledge_base_id = run_knowledge_base_id
          and d.status = 'ready'
          and d.deleted_at is null
          and position(ev.quote_text in dc.text) > 0
     )
  ) then
    raise exception using errcode = 'P0001', message = 'Claim evidence failed database-side source validation.';
  end if;

  delete from public.answer_claims where qa_run_id = p_qa_run_id;
  delete from public.retrieval_results where qa_run_id = p_qa_run_id;

  insert into public.retrieval_results (
    qa_run_id,
    chunk_id,
    document_id,
    rank,
    distance,
    relevance_score,
    selected,
    document_name_snapshot,
    chunk_text_snapshot,
    locator_snapshot
  )
  select
    p_qa_run_id,
    rr.chunk_id,
    rr.document_id,
    rr.rank,
    rr.distance,
    rr.relevance_score,
    coalesce(rr.selected, true),
    rr.document_name_snapshot,
    rr.chunk_text_snapshot,
    coalesce(rr.locator_snapshot, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_retrieval_rows, '[]'::jsonb)) as rr(
      chunk_id uuid,
      document_id uuid,
      rank integer,
      distance double precision,
      relevance_score numeric,
      selected boolean,
      document_name_snapshot text,
      chunk_text_snapshot text,
      locator_snapshot jsonb
    );

  insert into public.answer_claims (
    qa_run_id,
    claim_index,
    claim_text,
    claim_type,
    weight,
    support_status
  )
  select
    p_qa_run_id,
    cr.claim_index,
    cr.claim_text,
    cr.claim_type,
    cr.weight,
    cr.support_status::public.claim_support_status
    from jsonb_to_recordset(coalesce(p_claim_rows, '[]'::jsonb)) as cr(
      claim_index integer,
      claim_text text,
      claim_type text,
      weight numeric,
      support_status text
    );

  insert into public.evidence_items (
    claim_id,
    qa_run_id,
    retrieval_result_id,
    chunk_id,
    document_id,
    citation_label,
    quote_text,
    locator,
    support_score,
    document_name_snapshot,
    document_version_snapshot
  )
  select
    c.id,
    p_qa_run_id,
    (
      select rr.id
        from public.retrieval_results rr
       where rr.qa_run_id = p_qa_run_id
         and rr.chunk_id = ev.chunk_id
         and rr.document_id = ev.document_id
         and rr.selected
         and rr.locator_snapshot ->> 'citation_label' = ev.citation_label
       order by rr.rank
       limit 1
    ),
    ev.chunk_id,
    ev.document_id,
    ev.citation_label,
    ev.quote_text,
    coalesce(ev.locator, '{}'::jsonb),
    ev.support_score,
    ev.document_name_snapshot,
    ev.document_version_snapshot
    from jsonb_to_recordset(coalesce(p_evidence_rows, '[]'::jsonb)) as ev(
      claim_index integer,
      citation_label text,
      quote_text text,
      chunk_id uuid,
      document_id uuid,
      locator jsonb,
      support_score numeric,
      document_name_snapshot text,
      document_version_snapshot integer
    )
    join public.answer_claims c
      on c.qa_run_id = p_qa_run_id
     and c.claim_index = ev.claim_index;

  insert into public.chat_messages (
    conversation_id,
    role,
    content,
    task_type,
    status,
    qa_run_id,
    model
  )
  values (
    run_conversation_id,
    'assistant',
    coalesce(p_answer_payload ->> 'answer', 'The answer could not be generated.'),
    p_classified_task_type,
    'completed',
    p_qa_run_id,
    p_model
  )
  returning id into resolved_assistant_message_id;

  update public.chat_messages
     set status = 'completed',
         task_type = p_requested_task_type
   where id = run_user_message_id;

  update public.qa_runs
     set assistant_message_id = resolved_assistant_message_id,
         requested_task_type = p_requested_task_type,
         classified_task_type = p_classified_task_type,
         classifier_confidence = p_classifier_confidence,
         task_understanding_details = coalesce(p_task_understanding_details, '{}'::jsonb),
         retrieval_config = coalesce(p_retrieval_config, '{}'::jsonb),
         answer_payload = coalesce(p_answer_payload, '{}'::jsonb),
         answer_text = p_answer_payload ->> 'answer',
         model = p_model,
         prompt_version = p_prompt_version,
         retrieval_score = nullif(p_metrics -> 'retrieval_score' ->> 'score', '')::numeric,
         evidence_coverage_score = nullif(p_metrics -> 'evidence_coverage' ->> 'score', '')::numeric,
         knowledge_match_score = nullif(p_metrics -> 'knowledge_match' ->> 'score', '')::numeric,
         confidence_score = nullif(p_metrics -> 'confidence' ->> 'score', '')::numeric,
         metric_details = coalesce(p_metrics, '{}'::jsonb),
         insufficient_reason = p_insufficient_reason,
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         latency_ms = p_latency_ms,
         status = p_status,
         completed_at = now()
   where id = p_qa_run_id;

  update public.conversations
     set updated_at = now()
   where id = run_conversation_id;

  return query select resolved_assistant_message_id;
end;
$$;

create or replace function public.fail_qa_run(
  p_qa_run_id uuid,
  p_user_message_id uuid,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.qa_runs
     set status = 'failed',
         error_code = p_error_code,
         error_message = p_error_message,
         completed_at = now()
   where id = p_qa_run_id;

  update public.chat_messages
     set status = 'failed',
         error_code = p_error_code,
         error_message = p_error_message
   where id = p_user_message_id;
end;
$$;

revoke execute on function public.start_qa_run(uuid, text, public.task_type, uuid)
  from public, anon, authenticated;
revoke execute on function public.set_qa_run_status(uuid, public.qa_run_status)
  from public, anon, authenticated;
revoke execute on function public.complete_qa_run(
  uuid, public.task_type, public.task_type, numeric, jsonb, jsonb, jsonb,
  jsonb, jsonb, jsonb, jsonb, public.qa_run_status, text, text, integer,
  integer, integer, text
) from public, anon, authenticated;
revoke execute on function public.fail_qa_run(uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.start_qa_run(uuid, text, public.task_type, uuid)
  to service_role;
grant execute on function public.set_qa_run_status(uuid, public.qa_run_status)
  to service_role;
grant execute on function public.complete_qa_run(
  uuid, public.task_type, public.task_type, numeric, jsonb, jsonb, jsonb,
  jsonb, jsonb, jsonb, jsonb, public.qa_run_status, text, text, integer,
  integer, integer, text
) to service_role;
grant execute on function public.fail_qa_run(uuid, uuid, text, text)
  to service_role;

commit;
