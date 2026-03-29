alter table if exists public.feedbacks
  add column if not exists deletion_state text not null default 'active',
  add column if not exists delete_requested_at timestamptz null,
  add column if not exists delete_failed_at timestamptz null,
  add column if not exists delete_error text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feedbacks_deletion_state_chk'
      and conrelid = 'public.feedbacks'::regclass
  ) then
    alter table public.feedbacks
      add constraint feedbacks_deletion_state_chk
      check (deletion_state in ('active', 'pending_cleanup', 'cleanup_failed'));
  end if;
end
$$;

create index if not exists idx_feedbacks_deletion_state_created_at
  on public.feedbacks (deletion_state, created_at desc);
