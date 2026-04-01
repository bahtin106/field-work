begin;

create or replace function public.upsert_password_change_log(
  p_user_id uuid,
  p_changed_by uuid default null,
  p_ip_address text default null,
  p_user_agent text default null,
  p_source text default null,
  p_window_seconds integer default 120
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row_id uuid;
  v_window interval := make_interval(secs => greatest(5, least(coalesce(p_window_seconds, 120), 3600)));
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  -- Prefer enriching the latest trigger-created row for this password-change event.
  update public.password_change_log l
  set
    changed_by = coalesce(p_changed_by, l.changed_by),
    ip_address = coalesce(nullif(btrim(coalesce(p_ip_address, '')), ''), l.ip_address),
    user_agent = coalesce(nullif(btrim(coalesce(p_user_agent, '')), ''), l.user_agent),
    notes = case
      when v_source is null then l.notes
      when l.notes is null or btrim(l.notes) = '' or l.notes = 'auth.users trigger' then v_source
      when position(v_source in l.notes) > 0 then l.notes
      else l.notes || ' | ' || v_source
    end
  where l.id = (
    select id
    from public.password_change_log x
    where x.user_id = p_user_id
      and x.changed_at >= now() - v_window
    order by x.changed_at desc, x.created_at desc
    limit 1
  )
  returning l.id into v_row_id;

  if v_row_id is not null then
    return v_row_id;
  end if;

  insert into public.password_change_log(
    user_id,
    changed_at,
    changed_by,
    ip_address,
    user_agent,
    notes,
    created_at
  )
  values (
    p_user_id,
    now(),
    coalesce(p_changed_by, p_user_id),
    nullif(btrim(coalesce(p_ip_address, '')), ''),
    nullif(btrim(coalesce(p_user_agent, '')), ''),
    coalesce(v_source, 'manual insert'),
    now()
  )
  returning id into v_row_id;

  return v_row_id;
end;
$$;

revoke all on function public.upsert_password_change_log(uuid, uuid, text, text, text, integer) from public;
grant execute on function public.upsert_password_change_log(uuid, uuid, text, text, text, integer) to service_role;

create or replace function public.cleanup_password_change_log(
  p_keep_days integer default 3650,
  p_batch_limit integer default 100000
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keep_days integer := greatest(30, least(coalesce(p_keep_days, 3650), 36500));
  v_limit integer := greatest(1, least(coalesce(p_batch_limit, 100000), 1000000));
  v_deleted integer := 0;
begin
  with doomed as (
    select ctid
    from public.password_change_log
    where coalesce(changed_at, created_at, now()) < now() - make_interval(days => v_keep_days)
    order by coalesce(changed_at, created_at, now()) asc
    limit v_limit
  )
  delete from public.password_change_log l
  using doomed d
  where l.ctid = d.ctid;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_password_change_log(integer, integer) from public;
grant execute on function public.cleanup_password_change_log(integer, integer) to service_role;

-- Optional daily retention job (if pg_cron installed).
do $$
declare
  v_exists boolean;
begin
  select exists(select 1 from pg_extension where extname = 'pg_cron') into v_exists;
  if v_exists then
    begin
      perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'password_change_log_cleanup';
    exception when others then
      null;
    end;

    perform cron.schedule(
      'password_change_log_cleanup',
      '35 3 * * *',
      'select public.cleanup_password_change_log(3650, 100000);'
    );
  end if;
end
$$;

commit;
