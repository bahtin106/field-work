begin;

-- Cleanup jobs must outlive the order they were created for. Permanent
-- Trash purge deletes the order in the same transaction that enqueues its
-- files, so ON DELETE CASCADE would otherwise discard the jobs before the
-- external-storage worker can see them.
alter table public.media_cleanup_queue
  drop constraint if exists media_cleanup_queue_order_id_fkey;

alter table public.media_cleanup_queue
  add constraint media_cleanup_queue_order_id_fkey
  foreign key (order_id)
  references public.orders(id)
  on delete set null;

comment on constraint media_cleanup_queue_order_id_fkey
  on public.media_cleanup_queue is
  'Preserves external-file cleanup jobs after their parent order is permanently deleted.';

commit;
