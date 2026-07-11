create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,
  name text not null default 'Error',
  message text not null,
  stack text null,
  extra jsonb null,
  app_version text null,
  environment text null,
  created_at timestamptz not null default now()
);

alter table public.error_logs add column if not exists user_id uuid null;
alter table public.error_logs add column if not exists name text not null default 'Error';
alter table public.error_logs add column if not exists message text not null default 'Unknown error';
alter table public.error_logs add column if not exists stack text null;
alter table public.error_logs add column if not exists extra jsonb null;
alter table public.error_logs add column if not exists app_version text null;
alter table public.error_logs add column if not exists environment text null;
alter table public.error_logs add column if not exists created_at timestamptz not null default now();

create index if not exists error_logs_created_at_idx on public.error_logs (created_at desc);
create index if not exists error_logs_user_id_created_at_idx on public.error_logs (user_id, created_at desc);

alter table public.error_logs enable row level security;

drop policy if exists error_logs_insert_own on public.error_logs;
create policy error_logs_insert_own
on public.error_logs
for insert
to authenticated
with check (user_id = auth.uid());

revoke all on table public.error_logs from anon;
revoke select, update, delete on table public.error_logs from authenticated;
grant insert on table public.error_logs to authenticated;
grant all on table public.error_logs to service_role;

create or replace function public.cleanup_error_logs(retention_days integer default 30)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count bigint;
begin
  delete from public.error_logs
  where created_at < now() - make_interval(days => greatest(coalesce(retention_days, 30), 1));
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_error_logs(integer) from public, anon, authenticated;
grant execute on function public.cleanup_error_logs(integer) to service_role;
