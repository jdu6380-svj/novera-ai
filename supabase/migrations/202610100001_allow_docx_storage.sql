-- Keep the already-created production bucket aligned with the application upload allowlist.
begin;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain'
]
where id = 'knowledge-files';

commit;
