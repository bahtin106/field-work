BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS feed_entered_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public.tg_orders_set_feed_entered_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'В ленте' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.feed_entered_at := COALESCE(NEW.feed_entered_at, now());
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      NEW.feed_entered_at := now();
    ELSE
      NEW.feed_entered_at := COALESCE(NEW.feed_entered_at, OLD.feed_entered_at, now());
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'В ленте' THEN
    NEW.feed_entered_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_orders_set_feed_entered_at'
      AND tgrelid = 'public.orders'::regclass
  ) THEN
    CREATE TRIGGER trg_orders_set_feed_entered_at
      BEFORE INSERT OR UPDATE OF status ON public.orders
      FOR EACH ROW
      EXECUTE FUNCTION public.tg_orders_set_feed_entered_at();
  END IF;
END $$;

UPDATE public.orders
SET feed_entered_at = COALESCE(feed_entered_at, updated_at, created_at, now())
WHERE status = 'В ленте'
  AND assigned_to IS NULL
  AND feed_entered_at IS NULL;

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
      COALESCE(o.feed_entered_at, o.updated_at, o.created_at, now()) AS feed_since_ts
    FROM public.orders o
    WHERE o.status = 'В ленте'
      AND o.assigned_to IS NULL
  ),
  candidates_with_recipients AS (
    SELECT
      c.order_id,
      c.company_id,
      r.user_id AS recipient_user_id,
      c.feed_since_ts,
      GREATEST(
        1,
        LEAST(
          43200,
          COALESCE(np.reminder_delay_minutes, v_default_delay_minutes)
        )
      ) AS delay_minutes
    FROM candidates c
    JOIN public.get_company_notification_recipients(c.company_id) r ON true
    LEFT JOIN public.notification_prefs np ON np.user_id = r.user_id
    WHERE COALESCE(np.allow, true) = true
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
        'delay_minutes', c.delay_minutes
      ),
      'feed_stale_reminder:' || c.order_id || ':' || c.recipient_user_id::text || ':' ||
        extract(epoch from date_trunc('second', c.feed_since_ts))::bigint::text
    FROM candidates_with_recipients c
    WHERE c.feed_since_ts <= now() - make_interval(mins => c.delay_minutes)
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM inserted;

  RETURN COALESCE(v_inserted, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_stale_feed_reminders(interval) TO service_role;

COMMIT;
