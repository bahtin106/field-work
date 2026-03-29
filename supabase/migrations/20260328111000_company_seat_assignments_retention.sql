begin;

-- Fast path for retention cleanup over historical (revoked) rows.
create index if not exists idx_company_seat_assignments_revoked_at
  on public.company_seat_assignments (revoked_at)
  where revoked_at is not null;

create or replace function public.cleanup_company_seat_assignments_history(
  p_keep_months integer default 36,
  p_batch_limit integer default 50000
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keep_months integer := greatest(1, least(coalesce(p_keep_months, 36), 240));
  v_limit integer := greatest(1, least(coalesce(p_batch_limit, 50000), 200000));
  v_cutoff timestamptz := now() - make_interval(months => v_keep_months);
  v_deleted integer := 0;
begin
  with doomed as (
    select ctid
    from public.company_seat_assignments
    where revoked_at is not null
      and revoked_at < v_cutoff
    order by revoked_at asc
    limit v_limit
  )
  delete from public.company_seat_assignments s
  using doomed d
  where s.ctid = d.ctid;

  get diagnostics v_deleted = row_count;
  return coalesce(v_deleted, 0);
end;
$$;

revoke all on function public.cleanup_company_seat_assignments_history(integer, integer) from public;
grant execute on function public.cleanup_company_seat_assignments_history(integer, integer) to service_role;

-- One-time cleanup now.
select public.cleanup_company_seat_assignments_history(36, 50000);

-- Optional scheduler via pg_cron, if installed.
do $$
declare
  v_exists boolean;
begin
  select exists(select 1 from pg_extension where extname = 'pg_cron') into v_exists;
  if v_exists then
    begin
      perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'company_seat_assignments_history_cleanup';
    exception when others then
      null;
    end;

    perform cron.schedule(
      'company_seat_assignments_history_cleanup',
      '23 3 * * *',
      'select public.cleanup_company_seat_assignments_history(36, 50000);'
    );
  end if;
end
$$;

commit;

