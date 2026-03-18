BEGIN;

CREATE OR REPLACE FUNCTION public.tg_orders_enqueue_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id text;
  v_company_id uuid;
  v_transition_key text;
  v_actor_user_id uuid;
  v_creator_user_id uuid;
BEGIN
  v_order_id := NEW.id::text;
  v_company_id := NEW.company_id;
  v_transition_key := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
  v_actor_user_id := auth.uid();
  v_creator_user_id := COALESCE(NEW.created_by_user_id, v_actor_user_id);

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'В ленте' AND NEW.assigned_to IS NULL THEN
      PERFORM public.enqueue_notification_event(
        'feed_new_order',
        v_company_id,
        v_order_id,
        NULL,
        jsonb_build_object(
          'order_id', v_order_id,
          'event', 'feed_new_order',
          'creator_user_id', v_creator_user_id,
          'actor_user_id', v_actor_user_id
        ),
        'feed_new_order:' || v_order_id || ':' || v_transition_key
      );
    ELSIF NEW.assigned_to IS NOT NULL THEN
      PERFORM public.enqueue_notification_event(
        'assigned_new_order',
        v_company_id,
        v_order_id,
        NEW.assigned_to,
        jsonb_build_object('order_id', v_order_id, 'event', 'assigned_new_order'),
        'assigned_new_order:' || v_order_id || ':' || NEW.assigned_to::text || ':' || v_transition_key
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_creator_user_id := COALESCE(NEW.created_by_user_id, OLD.created_by_user_id, v_actor_user_id);

    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
       AND NEW.assigned_to IS NOT NULL THEN
      PERFORM public.enqueue_notification_event(
        'assigned_new_order',
        v_company_id,
        v_order_id,
        NEW.assigned_to,
        jsonb_build_object('order_id', v_order_id, 'event', 'assigned_new_order'),
        'assigned_new_order:' || v_order_id || ':' || NEW.assigned_to::text || ':' || v_transition_key
      );
    END IF;

    IF NEW.status = 'В ленте'
       AND NEW.assigned_to IS NULL
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public.enqueue_notification_event(
        'feed_new_order',
        v_company_id,
        v_order_id,
        NULL,
        jsonb_build_object(
          'order_id', v_order_id,
          'event', 'feed_new_order',
          'creator_user_id', v_creator_user_id,
          'actor_user_id', v_actor_user_id,
          'updated_by_user_id', v_actor_user_id
        ),
        'feed_new_order:' || v_order_id || ':' || v_transition_key
      );
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
