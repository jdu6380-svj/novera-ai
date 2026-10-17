-- Novera AI: authenticated private workspaces and document ownership.
-- Live route handlers resolve the workspace from the authenticated user. The
-- portfolio Production demo remains on its separate, read-only data path.

begin;

alter table public.knowledge_bases
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create unique index if not exists knowledge_bases_owner_idx
  on public.knowledge_bases(owner_id)
  where owner_id is not null;

create index if not exists documents_knowledge_base_created_idx
  on public.documents(knowledge_base_id, created_at desc)
  where deleted_at is null;

comment on column public.knowledge_bases.owner_id is
  'Authenticated Supabase user who owns this private knowledge workspace. Null is reserved for unclaimed or read-only workspaces.';

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_workspace_member(workspace_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select workspace_id is not null
    and exists (
      select 1
      from public.knowledge_bases kb
      where kb.id = $1
        and kb.owner_id = (select auth.uid())
    );
$$;

revoke all on function private.is_workspace_member(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;

comment on function private.is_workspace_member(uuid) is
  'RLS helper: true only when the current authenticated user owns the workspace.';

drop policy if exists documents_owner_select on public.documents;
drop policy if exists documents_owner_insert on public.documents;
drop policy if exists documents_owner_update on public.documents;
drop policy if exists documents_owner_delete on public.documents;
drop policy if exists processing_jobs_owner_select on public.document_processing_jobs;
drop policy if exists chunks_owner_select on public.document_chunks;
drop policy if exists conversations_owner_select on public.conversations;
drop policy if exists chat_messages_owner_select on public.chat_messages;
drop policy if exists qa_runs_owner_select on public.qa_runs;
drop policy if exists retrieval_results_owner_select on public.retrieval_results;
drop policy if exists answer_claims_owner_select on public.answer_claims;
drop policy if exists evidence_items_owner_select on public.evidence_items;
drop policy if exists qa_feedback_owner_select on public.qa_feedback;
drop policy if exists knowledge_insights_owner_select on public.knowledge_insight_logs;

drop policy if exists knowledge_files_owner_select on storage.objects;
drop policy if exists knowledge_files_owner_insert on storage.objects;
drop policy if exists knowledge_files_owner_delete on storage.objects;
drop function if exists public.is_workspace_member(uuid);

-- These policies are defense in depth for future authenticated Data API use.
-- Server-side application work continues to use service_role after validating
-- the request user and workspace at the route boundary.
drop policy if exists knowledge_bases_owner_select on public.knowledge_bases;
create policy knowledge_bases_owner_select on public.knowledge_bases
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists knowledge_bases_owner_insert on public.knowledge_bases;
create policy knowledge_bases_owner_insert on public.knowledge_bases
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists knowledge_bases_owner_update on public.knowledge_bases;
create policy knowledge_bases_owner_update on public.knowledge_bases
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists knowledge_bases_owner_delete on public.knowledge_bases;
create policy knowledge_bases_owner_delete on public.knowledge_bases
  for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists documents_owner_select on public.documents;
create policy documents_owner_select on public.documents
  for select to authenticated
  using (private.is_workspace_member(knowledge_base_id));

drop policy if exists documents_owner_insert on public.documents;
create policy documents_owner_insert on public.documents
  for insert to authenticated
  with check (private.is_workspace_member(knowledge_base_id));

drop policy if exists documents_owner_update on public.documents;
create policy documents_owner_update on public.documents
  for update to authenticated
  using (private.is_workspace_member(knowledge_base_id))
  with check (private.is_workspace_member(knowledge_base_id));

drop policy if exists documents_owner_delete on public.documents;
create policy documents_owner_delete on public.documents
  for delete to authenticated
  using (private.is_workspace_member(knowledge_base_id));

drop policy if exists processing_jobs_owner_select on public.document_processing_jobs;
create policy processing_jobs_owner_select on public.document_processing_jobs
  for select to authenticated
  using (exists (
    select 1 from public.documents d
    where d.id = document_id and private.is_workspace_member(d.knowledge_base_id)
  ));

drop policy if exists chunks_owner_select on public.document_chunks;
create policy chunks_owner_select on public.document_chunks
  for select to authenticated
  using (exists (
    select 1 from public.documents d
    where d.id = document_id and private.is_workspace_member(d.knowledge_base_id)
  ));

drop policy if exists conversations_owner_select on public.conversations;
create policy conversations_owner_select on public.conversations
  for select to authenticated
  using (private.is_workspace_member(knowledge_base_id));

drop policy if exists qa_runs_owner_select on public.qa_runs;
create policy qa_runs_owner_select on public.qa_runs
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and private.is_workspace_member(c.knowledge_base_id)
  ));

drop policy if exists chat_messages_owner_select on public.chat_messages;
create policy chat_messages_owner_select on public.chat_messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and private.is_workspace_member(c.knowledge_base_id)
  ));

drop policy if exists retrieval_results_owner_select on public.retrieval_results;
create policy retrieval_results_owner_select on public.retrieval_results
  for select to authenticated
  using (exists (
    select 1 from public.qa_runs q
    join public.conversations c on c.id = q.conversation_id
    where q.id = qa_run_id and private.is_workspace_member(c.knowledge_base_id)
  ));

drop policy if exists answer_claims_owner_select on public.answer_claims;
create policy answer_claims_owner_select on public.answer_claims
  for select to authenticated
  using (exists (
    select 1 from public.qa_runs q
    join public.conversations c on c.id = q.conversation_id
    where q.id = qa_run_id and private.is_workspace_member(c.knowledge_base_id)
  ));

drop policy if exists evidence_items_owner_select on public.evidence_items;
create policy evidence_items_owner_select on public.evidence_items
  for select to authenticated
  using (exists (
    select 1 from public.qa_runs q
    join public.conversations c on c.id = q.conversation_id
    where q.id = qa_run_id and private.is_workspace_member(c.knowledge_base_id)
  ));

drop policy if exists qa_feedback_owner_select on public.qa_feedback;
create policy qa_feedback_owner_select on public.qa_feedback
  for select to authenticated
  using (exists (
    select 1 from public.qa_runs q
    join public.conversations c on c.id = q.conversation_id
    where q.id = qa_run_id and private.is_workspace_member(c.knowledge_base_id)
  ));

drop policy if exists knowledge_insights_owner_select on public.knowledge_insight_logs;
create policy knowledge_insights_owner_select on public.knowledge_insight_logs
  for select to authenticated
  using (private.is_workspace_member(knowledge_base_id));

-- Restrict Storage object listing/downloads to paths containing the owner's
-- workspace id. Signed upload URLs are still minted server-side after the
-- route has resolved the same workspace.
drop policy if exists knowledge_files_owner_select on storage.objects;
create policy knowledge_files_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'knowledge-files'
    and (storage.foldername(name))[1] = 'knowledge-bases'
    and case
      when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then private.is_workspace_member(((storage.foldername(name))[2])::uuid)
      else false
    end
  );

drop policy if exists knowledge_files_owner_insert on storage.objects;
create policy knowledge_files_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'knowledge-files'
    and (storage.foldername(name))[1] = 'knowledge-bases'
    and case
      when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then private.is_workspace_member(((storage.foldername(name))[2])::uuid)
      else false
    end
  );

drop policy if exists knowledge_files_owner_delete on storage.objects;
create policy knowledge_files_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'knowledge-files'
    and (storage.foldername(name))[1] = 'knowledge-bases'
    and case
      when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then private.is_workspace_member(((storage.foldername(name))[2])::uuid)
      else false
    end
  );

-- Direct Data API reads remain available only through row-scoped policies.
grant select on table
  public.knowledge_bases,
  public.documents,
  public.document_processing_jobs,
  public.document_chunks,
  public.conversations,
  public.chat_messages,
  public.qa_runs,
  public.retrieval_results,
  public.answer_claims,
  public.evidence_items,
  public.qa_feedback,
  public.knowledge_insight_logs
to authenticated;

commit;
