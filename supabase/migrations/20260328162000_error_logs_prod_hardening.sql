begin;

-- 1) Make inserts reliable.
alter table public.error_logs
  alter column ts set default now(),
  alter column ts set not null,
  alter column user_id set default app_uid();

-- 2) Add FK navigation arrow for user_id.
update public.error_logs e
set user_id = null
where e.user_id is not null
  and not exists (select 1 from public.profiles p where p.id = e.user_id);

alter table public.error_logs
  drop constraint if exists error_logs_user_id_fkey;

alter table public.error_logs
  add constraint error_logs_user_id_fkey
  foreign key (user_id)
  references public.profiles(id)
  on delete set null
  not valid;

alter table public.error_logs
  validate constraint error_logs_user_id_fkey;

-- 3) Defensive constraints.
alter table public.error_logs
  drop constraint if exists error_logs_name_or_message_present_check,
  drop constraint if exists error_logs_environment_nonempty_check;

alter table public.error_logs
  add constraint error_logs_name_or_message_present_check
    check (coalesce(nullif(btrim(name), ''), nullif(btrim(message), '')) is not null),
  add constraint error_logs_environment_nonempty_check
    check (environment is null or btrim(environment) <> '');

-- 4) Read/query performance.
create index if not exists error_logs_ts_desc_idx
  on public.error_logs (ts desc);

create index if not exists error_logs_user_ts_desc_idx
  on public.error_logs (user_id, ts desc);

-- 5) Tighten table grants (RLS remains source of row-level control).
revoke all on table public.error_logs from anon;
revoke all on table public.error_logs from authenticated;

grant insert, select on table public.error_logs to authenticated;
grant select, insert, update, delete on table public.error_logs to service_role;

commit;

-- 6) Retention: keep last 180 days of client error logs.
create or replace function public.cleanup_error_logs(p_keep_days integer default 180)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keep interval;
  v_deleted integer := 0;
begin
  v_keep := make_interval(days => greatest(1, coalesce(p_keep_days, 180)));

  with del as (
    delete from public.error_logs
    where ts < now() - v_keep
    returning 1
  )
  select count(*) into v_deleted from del;

  return v_deleted;
end;
$$;

revoke all on function public.cleanup_error_logs(integer) from public;
grant execute on function public.cleanup_error_logs(integer) to service_role;

select public.cleanup_error_logs(180);

do $$
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    if exists (select 1 from cron.job where jobname='error_logs_cleanup') then
      perform cron.unschedule((select jobid from cron.job where jobname='error_logs_cleanup' limit 1));
    end if;

    perform cron.schedule(
      'error_logs_cleanup',
      '30 3 * * *',
      'select public.cleanup_error_logs(180);'
    );
  end if;
end
$$;
