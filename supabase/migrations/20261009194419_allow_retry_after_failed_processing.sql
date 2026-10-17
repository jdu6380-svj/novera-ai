drop index if exists public.documents_active_sha256_idx;

create unique index documents_active_sha256_idx
  on public.documents (knowledge_base_id, sha256)
  where sha256 is not null
    and deleted_at is null
    and status in ('uploading', 'uploaded', 'processing', 'ready');
