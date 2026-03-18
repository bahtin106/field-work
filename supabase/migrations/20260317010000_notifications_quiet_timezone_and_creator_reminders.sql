BEGIN;

ALTER TABLE public.notification_prefs
  ADD COLUMN IF NOT EXISTS quiet_timezone text;

UPDATE public.notification_prefs np
SET quiet_timezone = COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC')
FROM public.profiles p
WHERE p.id = np.user_id
  AND (np.quiet_timezone IS NULL OR btrim(np.quiet_timezone) = '');

UPDATE public.notification_prefs
SET quiet_timezone = 'UTC'
WHERE quiet_timezone IS NULL OR btrim(quiet_timezone) = '';

ALTER TABLE public.notification_prefs
  ALTER COLUMN quiet_timezone SET DEFAULT 'UTC';

DROP FUNCTION IF EXISTS public.get_notification_prefs_bulk(uuid[]);

CREATE FUNCTION public.get_notification_prefs_bulk(
  p_user_ids uuid[]
)
RETURNS TABLE(
  user_id uuid,
  allow boolean,
  new_orders boolean,
  feed_orders boolean,
  reminders boolean,
  reminder_delay_minutes integer,
  quiet_start time,
  quiet_end time,
  quiet_timezone text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    np.user_id,
    np.allow,
    np.new_orders,
    np.feed_orders,
    np.reminders,
    np.reminder_delay_minutes,
    np.quiet_start,
    np.quiet_end,
    COALESCE(NULLIF(btrim(np.quiet_timezone), ''), 'UTC') AS quiet_timezone
  FROM public.notification_prefs np
  WHERE np.user_id = ANY(COALESCE(p_user_ids, ARRAY[]::uuid[]));
$$;

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
BEGIN
  v_order_id := NEW.id::text;
  v_company_id := NEW.company_id;
  v_transition_key := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'В ленте' AND NEW.assigned_to IS NULL THEN
      PERFORM public.enqueue_notification_event(
        'feed_new_order',
        v_company_id,
        v_order_id,
        NULL,
        jsonb_build_object('order_id', v_order_id, 'event', 'feed_new_order'),
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
        jsonb_build_object('order_id', v_order_id, 'event', 'feed_new_order'),
        'feed_new_order:' || v_order_id || ':' || v_transition_key
      );
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_stale_feed_reminders(
  p_delay interval DEFAULT interval '20 minutes'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
  v_default_delay_minutes integer :=
    GREATEST(1, LEAST(43200, COALESCE(FLOOR(EXTRACT(EPOCH FROM p_delay) / 60)::integer, 20)));
BEGIN
  IF to_regclass('public.orders') IS NULL THEN
    RETURN 0;
  END IF;

  WITH candidates AS (
    SELECT
      o.id::text AS order_id,
      o.company_id,
      COALESCE(o.feed_entered_at, o.updated_at, o.created_at, now()) AS feed_since_ts,
      COALESCE(
        o.created_by_user_id,
        CASE
          WHEN (to_jsonb(o)->>'created_by') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (to_jsonb(o)->>'created_by')::uuid
          WHEN (to_jsonb(o)->>'user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (to_jsonb(o)->>'user_id')::uuid
          WHEN (to_jsonb(o)->>'owner_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (to_jsonb(o)->>'owner_id')::uuid
          ELSE NULL
        END
      ) AS raw_creator_user_id
    FROM public.orders o
    WHERE o.status = 'В ленте'
      AND o.assigned_to IS NULL
  ),
  candidates_with_recipient AS (
    SELECT
      c.order_id,
      c.company_id,
      c.feed_since_ts,
      COALESCE(creator_profile.id, fallback_admin.id) AS recipient_user_id,
      CASE WHEN creator_profile.id IS NULL THEN true ELSE false END AS fallback_to_admin
    FROM candidates c
    LEFT JOIN public.profiles creator_profile
      ON creator_profile.id = c.raw_creator_user_id
     AND creator_profile.company_id = c.company_id
     AND creator_profile.role IN ('admin', 'dispatcher', 'worker')
     AND COALESCE(creator_profile.is_suspended, false) = false
     AND COALESCE(creator_profile.is_admin_blocked, false) = false
    LEFT JOIN LATERAL (
      SELECT p.id
      FROM public.profiles p
      WHERE p.company_id = c.company_id
        AND p.role = 'admin'
        AND COALESCE(p.is_suspended, false) = false
        AND COALESCE(p.is_admin_blocked, false) = false
      ORDER BY COALESCE(p.created_at, p.updated_at, now()) ASC, p.id ASC
      LIMIT 1
    ) fallback_admin ON true
  ),
  candidates_with_delay AS (
    SELECT
      c.order_id,
      c.company_id,
      c.feed_since_ts,
      c.recipient_user_id,
      c.fallback_to_admin,
      GREATEST(
        1,
        LEAST(
          43200,
          COALESCE(np.reminder_delay_minutes, v_default_delay_minutes)
        )
      ) AS delay_minutes
    FROM candidates_with_recipient c
    LEFT JOIN public.notification_prefs np
      ON np.user_id = c.recipient_user_id
    WHERE c.recipient_user_id IS NOT NULL
      AND COALESCE(np.allow, true) = true
      AND COALESCE(np.reminders, true) = true
  ),
  inserted AS (
    INSERT INTO public.notification_events (
      event_type,
      company_id,
      order_id,
      recipient_user_id,
      payload,
      dedupe_key
    )
    SELECT
      'feed_stale_reminder',
      c.company_id,
      c.order_id,
      c.recipient_user_id,
      jsonb_build_object(
        'order_id', c.order_id,
        'event', 'feed_stale_reminder',
        'delay_minutes', c.delay_minutes,
        'fallback_to_admin', c.fallback_to_admin
      ),
      'feed_stale_reminder:' || c.order_id || ':' || c.recipient_user_id::text || ':' ||
        extract(epoch from date_trunc('second', c.feed_since_ts))::bigint::text
    FROM candidates_with_delay c
    WHERE c.feed_since_ts <= now() - make_interval(mins => c.delay_minutes)
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM inserted;

  RETURN COALESCE(v_inserted, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_notification_prefs_bulk(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_stale_feed_reminders(interval) TO service_role;

COMMIT;
