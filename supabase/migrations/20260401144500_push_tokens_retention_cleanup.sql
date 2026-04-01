begin;

create index if not exists idx_push_tokens_seen_valid
  on public.push_tokens (is_valid, last_seen_at);

create index if not exists idx_push_tokens_device_seen
  on public.push_tokens (user_id, device_id, last_seen_at desc);

create or replace function public.cleanup_push_tokens_retention(
  p_invalid_keep_days integer default 120,
  p_valid_stale_days integer default 730,
  p_batch_limit integer default 50000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invalid_keep_days integer := greatest(1, least(coalesce(p_invalid_keep_days, 120), 3650));
  v_valid_stale_days integer := greatest(30, least(coalesce(p_valid_stale_days, 730), 3650));
  v_limit integer := greatest(1, least(coalesce(p_batch_limit, 50000), 500000));
  v_deleted_invalid integer := 0;
  v_deleted_valid_stale integer := 0;
begin
  -- 1) Delete invalid tokens older than retention window.
  with doomed as (
    select ctid
    from public.push_tokens
    where coalesce(is_valid, true) = false
      and coalesce(last_seen_at, updated_at, created_at, now()) < now() - make_interval(days => v_invalid_keep_days)
    order by coalesce(last_seen_at, updated_at, created_at, now()) asc
    limit v_limit
  )
  delete from public.push_tokens pt
  using doomed d
  where pt.ctid = d.ctid;
  get diagnostics v_deleted_invalid = row_count;

  -- 2) Delete very stale valid tokens (device/app will re-register when active again).
  with doomed as (
    select ctid
    from public.push_tokens
    where coalesce(is_valid, true) = true
      and coalesce(last_seen_at, updated_at, created_at, now()) < now() - make_interval(days => v_valid_stale_days)
    order by coalesce(last_seen_at, updated_at, created_at, now()) asc
    limit greatest(0, v_limit - v_deleted_invalid)
  )
  delete from public.push_tokens pt
  using doomed d
  where pt.ctid = d.ctid;
  get diagnostics v_deleted_valid_stale = row_count;

  return jsonb_build_object(
    'deleted_invalid', v_deleted_invalid,
    'deleted_valid_stale', v_deleted_valid_stale,
    'invalid_keep_days', v_invalid_keep_days,
    'valid_stale_days', v_valid_stale_days,
    'batch_limit', v_limit
  );
end;
$$;

revoke all on function public.cleanup_push_tokens_retention(integer, integer, integer) from public;
grant execute on function public.cleanup_push_tokens_retention(integer, integer, integer) to service_role;

-- One-time safe cleanup with conservative thresholds.
select public.cleanup_push_tokens_retention(120, 730, 50000);

-- Daily scheduler (if pg_cron is installed).
do $$
declare
  v_exists boolean;
begin
  select exists(select 1 from pg_extension where extname = 'pg_cron') into v_exists;
  if v_exists then
    begin
      perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'push_tokens_retention_cleanup';
    exception when others then
      null;
    end;

    perform cron.schedule(
      'push_tokens_retention_cleanup',
      '41 3 * * *',
      'select public.cleanup_push_tokens_retention(120, 730, 50000);'
    );
  end if;
end
$$;

commit;
