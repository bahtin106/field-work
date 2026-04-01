begin;

alter table public.subscription_email_notifications enable row level security;
alter table public.subscription_email_notifications force row level security;

drop policy if exists subscription_email_notifications_service_role_all on public.subscription_email_notifications;
create policy subscription_email_notifications_service_role_all
on public.subscription_email_notifications
as permissive
for all
to service_role
using (true)
with check (true);

revoke all on table public.subscription_email_notifications from anon;
revoke all on table public.subscription_email_notifications from authenticated;
revoke all on table public.subscription_email_notifications from public;
grant select, insert, update, delete on table public.subscription_email_notifications to service_role;

revoke all on sequence public.subscription_email_notifications_id_seq from anon;
revoke all on sequence public.subscription_email_notifications_id_seq from authenticated;
revoke all on sequence public.subscription_email_notifications_id_seq from public;
grant usage, select on sequence public.subscription_email_notifications_id_seq to service_role;

create index if not exists idx_subscription_email_notifications_company_sent
  on public.subscription_email_notifications (company_id, sent_at desc);

create index if not exists idx_subscription_email_notifications_recipient_sent
  on public.subscription_email_notifications (recipient_user_id, sent_at desc);

-- Lock down subscription-email infra RPCs to service_role only.
revoke all on function public.subscription_email_retry_delay(integer) from public, anon, authenticated;
grant execute on function public.subscription_email_retry_delay(integer) to service_role;

revoke all on function public.enqueue_due_subscription_email_jobs(timestamptz) from public, anon, authenticated;
grant execute on function public.enqueue_due_subscription_email_jobs(timestamptz) to service_role;

revoke all on function public.claim_subscription_email_jobs(integer, interval) from public, anon, authenticated;
grant execute on function public.claim_subscription_email_jobs(integer, interval) to service_role;

revoke all on function public.finish_subscription_email_job(bigint, boolean, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.finish_subscription_email_job(bigint, boolean, text, integer, jsonb) to service_role;

revoke all on function public.requeue_subscription_email_job(bigint) from public, anon, authenticated;
grant execute on function public.requeue_subscription_email_job(bigint) to service_role;

revoke all on function public.get_subscription_email_sla_breaches() from public, anon, authenticated;
grant execute on function public.get_subscription_email_sla_breaches() to service_role;

-- Extend daily retention with subscription_email_notifications cleanup.
create or replace function public.cleanup_background_tables_retention(
  p_notification_days integer default 180,
  p_subscription_email_days integer default 365,
  p_media_cleanup_days integer default 90,
  p_messenger_update_days integer default 30,
  p_batch_limit integer default 200000,
  p_subscription_dead_letters_days integer default 3650
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
  v_subscription_dead_letters_days integer := greatest(30, least(coalesce(p_subscription_dead_letters_days, 3650), 36500));
  v_limit integer := greatest(1, least(coalesce(p_batch_limit, 200000), 1000000));
  v_deleted_notification integer := 0;
  v_deleted_subscription integer := 0;
  v_deleted_media_cleanup integer := 0;
  v_deleted_messenger_updates integer := 0;
  v_deleted_subscription_dead_letters integer := 0;
  v_deleted_subscription_notifications integer := 0;
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
    from public.subscription_email_dead_letters
    where created_at < now() - make_interval(days => v_subscription_dead_letters_days)
    order by created_at asc
    limit v_limit
  )
  delete from public.subscription_email_dead_letters dl
  using doomed d
  where dl.ctid = d.ctid;
  get diagnostics v_deleted_subscription_dead_letters = row_count;

  with doomed as (
    select ctid
    from public.subscription_email_notifications
    where coalesce(sent_at, created_at) < now() - make_interval(days => v_subscription_dead_letters_days)
    order by coalesce(sent_at, created_at) asc
    limit v_limit
  )
  delete from public.subscription_email_notifications n
  using doomed d
  where n.ctid = d.ctid;
  get diagnostics v_deleted_subscription_notifications = row_count;

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
    'subscription_email_dead_letters', v_deleted_subscription_dead_letters,
    'subscription_email_notifications', v_deleted_subscription_notifications,
    'media_cleanup_queue', v_deleted_media_cleanup,
    'messenger_update_log', v_deleted_messenger_updates
  );
end;
$$;

revoke all on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer, integer) to service_role;

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
begin
  return public.cleanup_background_tables_retention(
    p_notification_days,
    p_subscription_email_days,
    p_media_cleanup_days,
    p_messenger_update_days,
    p_batch_limit,
    3650
  );
end;
$$;

revoke all on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer) to service_role;

commit;
