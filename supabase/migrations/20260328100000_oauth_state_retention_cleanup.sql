begin;

-- Fast purge path for expired OAuth states.
create index if not exists idx_company_integration_oauth_states_expires_at
  on public.company_integration_oauth_states (expires_at);

create or replace function public.cleanup_expired_company_integration_oauth_states(
  p_batch_limit integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_batch_limit, 5000), 50000));
  v_deleted integer := 0;
begin
  with doomed as (
    select ctid
    from public.company_integration_oauth_states
    where expires_at < now()
    order by expires_at asc
    limit v_limit
  )
  delete from public.company_integration_oauth_states s
  using doomed d
  where s.ctid = d.ctid;

  get diagnostics v_deleted = row_count;
  return coalesce(v_deleted, 0);
end;
$$;

revoke all on function public.cleanup_expired_company_integration_oauth_states(integer) from public;
grant execute on function public.cleanup_expired_company_integration_oauth_states(integer) to service_role;

-- One-time cleanup now.
select public.cleanup_expired_company_integration_oauth_states(5000);

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
      where jobname = 'company_integration_oauth_states_cleanup';
    exception when others then
      null;
    end;

    perform cron.schedule(
      'company_integration_oauth_states_cleanup',
      '11 * * * *',
      'select public.cleanup_expired_company_integration_oauth_states(5000);'
    );
  end if;
end
$$;

commit;

