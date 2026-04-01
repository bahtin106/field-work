begin;

-- Harden password_change_log access for production.

alter table public.password_change_log enable row level security;
alter table public.password_change_log force row level security;

-- Tighten nullability for audit timestamps.
update public.password_change_log set changed_at = now() where changed_at is null;
update public.password_change_log set created_at = now() where created_at is null;

alter table public.password_change_log
  alter column changed_at set default now(),
  alter column changed_at set not null,
  alter column created_at set default now(),
  alter column created_at set not null;

create index if not exists idx_password_change_log_changed_by
  on public.password_change_log(changed_by);

drop policy if exists "Users can view own password change logs" on public.password_change_log;
drop policy if exists "Allow insert password logs" on public.password_change_log;
drop policy if exists "Only insert password logs via service role" on public.password_change_log;

create policy password_change_log_select_own_or_admin
  on public.password_change_log
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or public.is_admin()
  );

create policy password_change_log_insert_service_role
  on public.password_change_log
  for insert
  to service_role
  with check (true);

revoke all on table public.password_change_log from public, anon, authenticated, service_role;
grant select on table public.password_change_log to authenticated;
grant select, insert on table public.password_change_log to service_role;

commit;
