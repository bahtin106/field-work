begin;

-- Retention indexes
create index if not exists idx_notification_events_sent_at
  on public.notification_events (sent_at)
  where sent_at is not null;

create index if not exists idx_subscription_email_queue_sent_at
  on public.subscription_email_queue (sent_at)
  where sent_at is not null;

create index if not exists idx_subscription_email_queue_dead_letter_at
  on public.subscription_email_queue (dead_letter_at)
  where dead_letter_at is not null;

create index if not exists idx_media_cleanup_queue_processed_at
  on public.media_cleanup_queue (processed_at)
  where processed_at is not null;

create index if not exists idx_messenger_update_log_received_at
  on public.messenger_update_log (received_at);

create or replace function public.cleanup_background_tables_retention(
  p_notification_days integer default 180,
  p_subscription_email_days integer default 365,
  p_media_cleanup_days integer default 90,
  p_messenger_update_days integer default 30,
  p_batch_limit integer default 200000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification_days integer := greatest(1, least(coalesce(p_notification_days, 180), 3650));
  v_subscription_email_days integer := greatest(1, least(coalesce(p_subscription_email_days, 365), 3650));
  v_media_cleanup_days integer := greatest(1, least(coalesce(p_media_cleanup_days, 90), 3650));
  v_messenger_update_days integer := greatest(1, least(coalesce(p_messenger_update_days, 30), 3650));
  v_limit integer := greatest(1, least(coalesce(p_batch_limit, 200000), 1000000));
  v_deleted_notification integer := 0;
  v_deleted_subscription integer := 0;
  v_deleted_media_cleanup integer := 0;
  v_deleted_messenger_updates integer := 0;
begin
  with doomed as (
    select ctid
    from public.notification_events
    where status in ('sent', 'failed', 'error', 'dead', 'dead_letter')
      and coalesce(sent_at, updated_at, created_at) < now() - make_interval(days => v_notification_days)
    order by coalesce(sent_at, updated_at, created_at) asc
    limit v_limit
  )
  delete from public.notification_events e
  using doomed d
  where e.ctid = d.ctid;
  get diagnostics v_deleted_notification = row_count;

  with doomed as (
    select ctid
    from public.subscription_email_queue
    where status in ('sent', 'failed', 'error', 'dead_letter', 'cancelled')
      and coalesce(dead_letter_at, sent_at, updated_at, created_at) < now() - make_interval(days => v_subscription_email_days)
    order by coalesce(dead_letter_at, sent_at, updated_at, created_at) asc
    limit v_limit
  )
  delete from public.subscription_email_queue q
  using doomed d
  where q.ctid = d.ctid;
  get diagnostics v_deleted_subscription = row_count;

  with doomed as (
    select ctid
    from public.media_cleanup_queue
    where processed_at is not null
      and processed_at < now() - make_interval(days => v_media_cleanup_days)
    order by processed_at asc
    limit v_limit
  )
  delete from public.media_cleanup_queue m
  using doomed d
  where m.ctid = d.ctid;
  get diagnostics v_deleted_media_cleanup = row_count;

  with doomed as (
    select ctid
    from public.messenger_update_log
    where received_at < now() - make_interval(days => v_messenger_update_days)
    order by received_at asc
    limit v_limit
  )
  delete from public.messenger_update_log l
  using doomed d
  where l.ctid = d.ctid;
  get diagnostics v_deleted_messenger_updates = row_count;

  return jsonb_build_object(
    'notification_events', v_deleted_notification,
    'subscription_email_queue', v_deleted_subscription,
    'media_cleanup_queue', v_deleted_media_cleanup,
    'messenger_update_log', v_deleted_messenger_updates
  );
end;
$$;

revoke all on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer) from public;
grant execute on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer) to service_role;

-- One-time cleanup with safe defaults.
select public.cleanup_background_tables_retention(180, 365, 90, 30, 200000);

-- Optional scheduler via pg_cron.
do $$
declare
  v_exists boolean;
begin
  select exists(select 1 from pg_extension where extname = 'pg_cron') into v_exists;
  if v_exists then
    begin
      perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'background_tables_retention_cleanup';
    exception when others then
      null;
    end;

    perform cron.schedule(
      'background_tables_retention_cleanup',
      '37 3 * * *',
      'select public.cleanup_background_tables_retention(180, 365, 90, 30, 200000);'
    );
  end if;
end
$$;

commit;

