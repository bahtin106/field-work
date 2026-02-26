BEGIN;

ALTER TABLE public.notification_prefs
  ADD COLUMN IF NOT EXISTS reminder_delay_minutes integer NOT NULL DEFAULT 20;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_prefs_reminder_delay_minutes_check'
      AND conrelid = 'public.notification_prefs'::regclass
  ) THEN
    ALTER TABLE public.notification_prefs
      ADD CONSTRAINT notification_prefs_reminder_delay_minutes_check
      CHECK (reminder_delay_minutes BETWEEN 1 AND 43200);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_notification_prefs_bulk(
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
  quiet_end time
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
    np.quiet_end
  FROM public.notification_prefs np
  WHERE np.user_id = ANY(COALESCE(p_user_ids, ARRAY[]::uuid[]));
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
      CASE
        WHEN (to_jsonb(o)->>'created_by') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (to_jsonb(o)->>'created_by')::uuid
        WHEN (to_jsonb(o)->>'user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (to_jsonb(o)->>'user_id')::uuid
        WHEN (to_jsonb(o)->>'owner_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (to_jsonb(o)->>'owner_id')::uuid
        ELSE NULL
      END AS creator_user_id,
      COALESCE(o.created_at, o.updated_at, now()) AS created_ts
    FROM public.orders o
    WHERE o.status = 'В ленте'
      AND o.assigned_to IS NULL
  ),
  candidates_with_delay AS (
    SELECT
      c.order_id,
      c.company_id,
      c.creator_user_id,
      c.created_ts,
      GREATEST(
        1,
        LEAST(
          43200,
          COALESCE(np.reminder_delay_minutes, v_default_delay_minutes)
        )
      ) AS delay_minutes
    FROM candidates c
    LEFT JOIN public.notification_prefs np ON np.user_id = c.creator_user_id
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
      c.creator_user_id,
      jsonb_build_object('order_id', c.order_id, 'event', 'feed_stale_reminder'),
      'feed_stale_reminder:' || c.order_id
    FROM candidates_with_delay c
    WHERE c.creator_user_id IS NOT NULL
      AND c.created_ts <= now() - make_interval(mins => c.delay_minutes)
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM inserted;

  RETURN COALESCE(v_inserted, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_notification_prefs_bulk(uuid[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_stale_feed_reminders(interval) TO service_role;

COMMIT;
