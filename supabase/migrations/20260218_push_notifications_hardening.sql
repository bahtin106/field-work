BEGIN;

-- -----------------------------------------------------------------------------
-- Security hardening for worker-only RPCs
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_company_notification_recipients(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.get_notification_prefs_bulk(uuid[]) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.get_push_tokens_bulk(uuid[]) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_company_notification_recipients(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_notification_prefs_bulk(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_push_tokens_bulk(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.get_company_notification_recipients(
  p_company_id uuid
)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id AS user_id
  FROM public.profiles p
  WHERE p.company_id = p_company_id
    AND p.role IN ('admin', 'dispatcher', 'worker')
    AND COALESCE(p.is_suspended, false) = false
    AND COALESCE(p.is_admin_blocked, false) = false;
$$;

-- -----------------------------------------------------------------------------
-- Reliable creator source for stale reminders
-- -----------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.orders
  ALTER COLUMN created_by_user_id SET DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS idx_orders_created_by_user_id
  ON public.orders (created_by_user_id);

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
      ) AS creator_user_id,
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
-- DB-native worker scheduler (pg_cron + pg_net)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_runtime_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled boolean NOT NULL DEFAULT true,
  push_send_url text NULL,
  push_worker_key text NULL,
  batch_limit integer NOT NULL DEFAULT 100 CHECK (batch_limit BETWEEN 1 AND 200),
  timeout_ms integer NOT NULL DEFAULT 8000 CHECK (timeout_ms BETWEEN 1000 AND 60000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_notification_runtime_config_updated_at'
      AND tgrelid = 'public.notification_runtime_config'::regclass
  ) THEN
    CREATE TRIGGER trg_notification_runtime_config_updated_at
      BEFORE UPDATE ON public.notification_runtime_config
      FOR EACH ROW
      EXECUTE FUNCTION public.tg_set_updated_at();
  END IF;
END $$;

INSERT INTO public.notification_runtime_config (id, enabled)
VALUES (true, true)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trigger_push_worker(
  p_limit integer DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conf public.notification_runtime_config%ROWTYPE;
  v_headers jsonb := jsonb_build_object('Content-Type', 'application/json');
  v_limit integer;
  v_req_id bigint;
BEGIN
  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'net.http_post is not available. Install/enable pg_net extension first.';
  END IF;

  SELECT * INTO v_conf
  FROM public.notification_runtime_config
  WHERE id = true
    AND enabled = true;

  IF NOT FOUND OR COALESCE(v_conf.push_send_url, '') = '' THEN
    RETURN NULL;
  END IF;

  IF COALESCE(v_conf.push_worker_key, '') <> '' THEN
    v_headers := v_headers || jsonb_build_object('x-worker-key', v_conf.push_worker_key);
  END IF;

  v_limit := LEAST(200, GREATEST(1, COALESCE(p_limit, v_conf.batch_limit, 100)));

  SELECT net.http_post(
    url := v_conf.push_send_url,
    body := jsonb_build_object('limit', v_limit),
    headers := v_headers,
    timeout_milliseconds := COALESCE(v_conf.timeout_ms, 8000)
  )
  INTO v_req_id;

  RETURN v_req_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_push_worker_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'cron.schedule is not available. Install/enable pg_cron extension first.';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'push-notifications-worker') THEN
    PERFORM cron.unschedule('push-notifications-worker');
  END IF;

  PERFORM cron.schedule(
    'push-notifications-worker',
    '* * * * *',
    'SELECT public.trigger_push_worker();'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.trigger_push_worker(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.schedule_push_worker_cron() TO service_role;

DO $$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM public.schedule_push_worker_cron();
  END IF;
END $$;

COMMIT;
