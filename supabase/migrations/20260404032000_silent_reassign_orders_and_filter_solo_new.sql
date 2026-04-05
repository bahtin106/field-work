BEGIN;

create or replace function public.tg_orders_enqueue_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id text;
  v_company_id uuid;
  v_transition_key text;
  v_actor_user_id uuid;
  v_creator_user_id uuid;
  v_suppress_assigned_notifications boolean := lower(coalesce(current_setting('app.suppress_assigned_notifications', true), '')) in ('1', 'true', 'yes', 'on');
begin
  v_order_id := new.id::text;
  v_company_id := new.company_id;
  v_transition_key := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
  v_actor_user_id := auth.uid();
  v_creator_user_id := coalesce(new.created_by_user_id, v_actor_user_id);

  if tg_op = 'INSERT' then
    if new.status = 'В ленте' and new.assigned_to is null then
      perform public.enqueue_notification_event(
        'feed_new_order',
        v_company_id,
        v_order_id,
        null,
        jsonb_build_object(
          'order_id', v_order_id,
          'event', 'feed_new_order',
          'creator_user_id', v_creator_user_id,
          'actor_user_id', v_actor_user_id
        ),
        'feed_new_order:' || v_order_id || ':' || v_transition_key
      );
    elsif new.assigned_to is not null and not v_suppress_assigned_notifications then
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
    v_creator_user_id := coalesce(new.created_by_user_id, old.created_by_user_id, v_actor_user_id);

    if new.assigned_to is distinct from old.assigned_to
       and new.assigned_to is not null
       and not v_suppress_assigned_notifications then
      perform public.enqueue_notification_event(
        'assigned_new_order',
        v_company_id,
        v_order_id,
        new.assigned_to,
        jsonb_build_object('order_id', v_order_id, 'event', 'assigned_new_order'),
        'assigned_new_order:' || v_order_id || ':' || new.assigned_to::text || ':' || v_transition_key
      );
    end if;

    if new.status = 'В ленте'
       and new.assigned_to is null
       and new.status is distinct from old.status then
      perform public.enqueue_notification_event(
        'feed_new_order',
        v_company_id,
        v_order_id,
        null,
        jsonb_build_object(
          'order_id', v_order_id,
          'event', 'feed_new_order',
          'creator_user_id', v_creator_user_id,
          'actor_user_id', v_actor_user_id,
          'updated_by_user_id', v_actor_user_id
        ),
        'feed_new_order:' || v_order_id || ':' || v_transition_key
      );
    end if;

    return new;
  end if;

  return new;
end;
$$;

create or replace function public.reassign_orders_with_options(
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_company_id uuid default null,
  p_silent_notifications boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  if p_from_user_id is null then
    raise exception 'p_from_user_id is required' using errcode = '22023';
  end if;
  if p_to_user_id is null then
    raise exception 'p_to_user_id is required' using errcode = '22023';
  end if;

  if p_silent_notifications then
    perform set_config('app.suppress_assigned_notifications', 'on', true);
  end if;

  update public.orders o
  set assigned_to = p_to_user_id
  where o.assigned_to = p_from_user_id
    and (p_company_id is null or o.company_id = p_company_id);

  get diagnostics v_rows = row_count;
  return coalesce(v_rows, 0);
end;
$$;

revoke all on function public.reassign_orders_with_options(uuid, uuid, uuid, boolean) from public;
grant execute on function public.reassign_orders_with_options(uuid, uuid, uuid, boolean) to authenticated;
grant execute on function public.reassign_orders_with_options(uuid, uuid, uuid, boolean) to service_role;

COMMIT;

