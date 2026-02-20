-- Push notifications pipeline:
-- 1) Stores user push settings/tokens
-- 2) Enqueues order-related notification events in DB triggers
-- 3) Provides claim/finish RPCs for edge-function worker
-- 4) Generates 30-minute stale feed reminders

BEGIN;

-- -----------------------------------------------------------------------------
-- Core tables
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  allow boolean NOT NULL DEFAULT true,
  new_orders boolean NOT NULL DEFAULT true,
  feed_orders boolean NOT NULL DEFAULT true,
  reminders boolean NOT NULL DEFAULT true,
  quiet_start time NULL,
  quiet_end time NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'unknown',
  device_id text NULL,
  is_valid boolean NOT NULL DEFAULT true,
  invalid_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'push_tokens_user_id_key'
      AND conrelid = 'public.push_tokens'::regclass
  ) THEN
    ALTER TABLE public.push_tokens DROP CONSTRAINT push_tokens_user_id_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_token_key ON public.push_tokens (token);
CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_user_token_key ON public.push_tokens (user_id, token);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_valid ON public.push_tokens (user_id, is_valid);

CREATE TABLE IF NOT EXISTS public.notification_events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('feed_new_order', 'assigned_new_order', 'feed_stale_reminder')),
  company_id uuid NOT NULL,
  order_id text NOT NULL,
  recipient_user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_events_status_available
  ON public.notification_events (status, available_at, id);

CREATE INDEX IF NOT EXISTS idx_notification_events_company
  ON public.notification_events (company_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Timestamps
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_notification_prefs_updated_at'
      AND tgrelid = 'public.notification_prefs'::regclass
  ) THEN
    CREATE TRIGGER trg_notification_prefs_updated_at
      BEFORE UPDATE ON public.notification_prefs
      FOR EACH ROW
      EXECUTE FUNCTION public.tg_set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_push_tokens_updated_at'
      AND tgrelid = 'public.push_tokens'::regclass
  ) THEN
    CREATE TRIGGER trg_push_tokens_updated_at
      BEFORE UPDATE ON public.push_tokens
      FOR EACH ROW
      EXECUTE FUNCTION public.tg_set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_notification_events_updated_at'
      AND tgrelid = 'public.notification_events'::regclass
  ) THEN
    CREATE TRIGGER trg_notification_events_updated_at
      BEFORE UPDATE ON public.notification_events
      FOR EACH ROW
      EXECUTE FUNCTION public.tg_set_updated_at();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Event enqueueing
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_notification_event(
  p_event_type text,
  p_company_id uuid,
  p_order_id text,
  p_recipient_user_id uuid,
  p_payload jsonb,
  p_dedupe_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notification_events (
    event_type,
    company_id,
    order_id,
    recipient_user_id,
    payload,
    dedupe_key
  )
  VALUES (
    p_event_type,
    p_company_id,
    p_order_id,
    p_recipient_user_id,
    COALESCE(p_payload, '{}'::jsonb),
    p_dedupe_key
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
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
BEGIN
  v_order_id := NEW.id::text;
  v_company_id := NEW.company_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'В ленте' AND NEW.assigned_to IS NULL THEN
      PERFORM public.enqueue_notification_event(
        'feed_new_order',
        v_company_id,
        v_order_id,
        NULL,
        jsonb_build_object('order_id', v_order_id, 'event', 'feed_new_order'),
        'feed_new_order:' || v_order_id
      );
    ELSIF NEW.assigned_to IS NOT NULL THEN
      PERFORM public.enqueue_notification_event(
        'assigned_new_order',
        v_company_id,
        v_order_id,
        NEW.assigned_to,
        jsonb_build_object('order_id', v_order_id, 'event', 'assigned_new_order'),
        'assigned_new_order:' || v_order_id || ':' || NEW.assigned_to::text
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
        'assigned_new_order:' || v_order_id || ':' || NEW.assigned_to::text
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
        'feed_new_order:' || v_order_id
      );
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.orders') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'trg_orders_enqueue_notifications'
        AND tgrelid = 'public.orders'::regclass
    ) THEN
      CREATE TRIGGER trg_orders_enqueue_notifications
        AFTER INSERT OR UPDATE OF status, assigned_to ON public.orders
        FOR EACH ROW
        EXECUTE FUNCTION public.tg_orders_enqueue_notifications();
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Reminder generation (order in feed > 30 minutes and still unassigned)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_stale_feed_reminders(
  p_delay interval DEFAULT interval '30 minutes'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
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
    FROM candidates c
    WHERE c.creator_user_id IS NOT NULL
      AND c.created_ts <= now() - p_delay
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM inserted;

  RETURN COALESCE(v_inserted, 0);
END;
$$;

-- -----------------------------------------------------------------------------
-- Worker RPCs
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_notification_events(
  p_limit integer DEFAULT 50
)
RETURNS SETOF public.notification_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.notification_events
    WHERE status = 'pending'
      AND available_at <= now()
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
  )
  UPDATE public.notification_events ne
  SET
    status = 'processing',
    attempt_count = ne.attempt_count + 1,
    updated_at = now()
  FROM picked
  WHERE ne.id = picked.id
  RETURNING ne.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_notification_event(
  p_event_id bigint,
  p_success boolean,
  p_error text DEFAULT NULL,
  p_retry_delay interval DEFAULT interval '3 minutes'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_success THEN
    UPDATE public.notification_events
    SET
      status = 'sent',
      sent_at = now(),
      last_error = NULL,
      updated_at = now()
    WHERE id = p_event_id;
    RETURN;
  END IF;

  UPDATE public.notification_events
  SET
    status = CASE WHEN attempt_count >= 5 THEN 'failed' ELSE 'pending' END,
    available_at = CASE WHEN attempt_count >= 5 THEN available_at ELSE now() + p_retry_delay END,
    last_error = LEFT(COALESCE(p_error, 'unknown error'), 2000),
    updated_at = now()
  WHERE id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_stale_feed_reminders(interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_notification_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_notification_event(bigint, boolean, text, interval) TO service_role;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_prefs_select_own ON public.notification_prefs;
CREATE POLICY notification_prefs_select_own
ON public.notification_prefs
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS notification_prefs_insert_own ON public.notification_prefs;
CREATE POLICY notification_prefs_insert_own
ON public.notification_prefs
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notification_prefs_update_own ON public.notification_prefs;
CREATE POLICY notification_prefs_update_own
ON public.notification_prefs
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_tokens_select_own ON public.push_tokens;
CREATE POLICY push_tokens_select_own
ON public.push_tokens
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS push_tokens_insert_own ON public.push_tokens;
CREATE POLICY push_tokens_insert_own
ON public.push_tokens
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_tokens_update_own ON public.push_tokens;
CREATE POLICY push_tokens_update_own
ON public.push_tokens
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_tokens_delete_own ON public.push_tokens;
CREATE POLICY push_tokens_delete_own
ON public.push_tokens
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS notification_events_service_role_all ON public.notification_events;
CREATE POLICY notification_events_service_role_all
ON public.notification_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMIT;
