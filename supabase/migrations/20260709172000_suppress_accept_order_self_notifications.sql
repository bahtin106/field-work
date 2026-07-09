create or replace function public.accept_order(p_order_id uuid)
returns boolean
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_updated int;
begin
  perform set_config('app.suppress_assigned_notifications', 'true', true);

  update public.orders o
  set assigned_to = auth.uid(),
      status = 'В работе'
  where o.id = p_order_id
    and o.assigned_to is null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

create or replace function public.tg_orders_enqueue_notifications()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
        jsonb_build_object(
          'order_id', v_order_id,
          'event', 'assigned_new_order',
          'actor_user_id', v_actor_user_id,
          'assigned_to_user_id', new.assigned_to
        ),
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
        jsonb_build_object(
          'order_id', v_order_id,
          'event', 'assigned_new_order',
          'actor_user_id', v_actor_user_id,
          'assigned_to_user_id', new.assigned_to
        ),
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
$function$;
