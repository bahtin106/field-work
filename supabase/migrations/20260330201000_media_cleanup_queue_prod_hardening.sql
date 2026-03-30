begin;

-- Optimize worker polling path:
-- pending jobs only, ordered by id, filtered by not_before and lock timeout checks.
create index if not exists idx_media_cleanup_queue_worker_pending_poll
  on public.media_cleanup_queue (provider, not_before, locked_at, id)
  where processed_at is null;

commit;

