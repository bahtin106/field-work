-- Prevent duplicate assigned_new_order events on a single update transition.

create or replace function public.tg_orders_enqueue_notifications()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order_id text;
  v_company_id uuid;
  v_transition_key text;
  v_assigned_event_sent boolean := false;
begin
  v_order_id := new.id::text;
  v_company_id := new.company_id;
  v_transition_key := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');

  if tg_op = 'INSERT' then
    if new.status = 'В ленте' and new.assigned_to is null then
      perform public.enqueue_notification_event(
        'feed_new_order',
        v_company_id,
        v_order_id,
        null,
        jsonb_build_object('order_id', v_order_id, 'event', 'feed_new_order'),
        'feed_new_order:' || v_order_id || ':' || v_transition_key
      );
    elsif new.assigned_to is not null then
      perform public.enqueue_notification_event(
        'assigned_new_order',
        v_company_id,
        v_order_id,
        new.assigned_to,
        jsonb_build_object('order_id', v_order_id, 'event', 'assigned_new_order'),
        'assigned_new_order:' || v_order_id || ':' || new.assigned_to::text || ':' || v_transition_key
      );
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.assigned_to is distinct from old.assigned_to
       and new.assigned_to is not null then
      perform public.enqueue_notification_event(
        'assigned_new_order',
        v_company_id,
        v_order_id,
        new.assigned_to,
        jsonb_build_object('order_id', v_order_id, 'event', 'assigned_new_order'),
        'assigned_new_order:' || v_order_id || ':' || new.assigned_to::text || ':' || v_transition_key
      );
      v_assigned_event_sent := true;
    end if;

    if new.status = 'В ленте'
       and new.assigned_to is null
       and new.status is distinct from old.status then
      perform public.enqueue_notification_event(
        'feed_new_order',
        v_company_id,
        v_order_id,
        null,
        jsonb_build_object('order_id', v_order_id, 'event', 'feed_new_order'),
        'feed_new_order:' || v_order_id || ':' || v_transition_key
      );
    end if;

    if new.status = 'Новый'
       and new.status is distinct from old.status
       and new.assigned_to is not null
       and not v_assigned_event_sent then
      perform public.enqueue_notification_event(
        'assigned_new_order',
        v_company_id,
        v_order_id,
        new.assigned_to,
        jsonb_build_object('order_id', v_order_id, 'event', 'assigned_new_order', 'status', new.status),
        'assigned_new_order:' || v_order_id || ':' || new.assigned_to::text || ':status-new:' || v_transition_key
      );
    end if;

    return new;
  end if;

  return new;
end;
$$;
