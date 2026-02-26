-- Speed up push delivery: trigger worker immediately on enqueue (best-effort),
-- while keeping cron as fallback.

create or replace function public.enqueue_notification_event(
  p_event_type text,
  p_company_id uuid,
  p_order_id text,
  p_recipient_user_id uuid,
  p_payload jsonb,
  p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted boolean := false;
begin
  insert into public.notification_events (
    event_type,
    company_id,
    order_id,
    recipient_user_id,
    payload,
    dedupe_key
  )
  values (
    p_event_type,
    p_company_id,
    p_order_id,
    p_recipient_user_id,
    coalesce(p_payload, '{}'::jsonb),
    p_dedupe_key
  )
  on conflict (dedupe_key) do nothing;

  get diagnostics v_inserted = row_count;

  -- Best-effort near real-time kick:
  -- 1) only when a new event was really inserted
  -- 2) single kick per transaction via advisory xact lock
  -- 3) fully optional, cron worker remains fallback
  if v_inserted and pg_try_advisory_xact_lock(hashtext('push_worker_kick')) then
    begin
      perform public.trigger_push_worker(100);
    exception
      when undefined_function then
        null;
      when others then
        null;
    end;
  end if;
end;
$$;

