BEGIN;

-- Reliable subscription email pipeline (queue + retries + DLQ + catch-up + SLA metrics)

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.subscription_email_runtime_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled boolean NOT NULL DEFAULT true,
  warning_catchup_days integer NOT NULL DEFAULT 3 CHECK (warning_catchup_days BETWEEN 0 AND 30),
  expired_catchup_days integer NOT NULL DEFAULT 30 CHECK (expired_catchup_days BETWEEN 1 AND 365),
  batch_limit integer NOT NULL DEFAULT 100 CHECK (batch_limit BETWEEN 1 AND 500),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 50),
  processing_timeout_seconds integer NOT NULL DEFAULT 900 CHECK (processing_timeout_seconds BETWEEN 30 AND 86400),
  backoff_base_seconds integer NOT NULL DEFAULT 60 CHECK (backoff_base_seconds BETWEEN 1 AND 3600),
  backoff_cap_seconds integer NOT NULL DEFAULT 21600 CHECK (backoff_cap_seconds BETWEEN 30 AND 172800),
  sla_max_delivery_lag_minutes integer NOT NULL DEFAULT 30 CHECK (sla_max_delivery_lag_minutes BETWEEN 1 AND 1440),
  sla_max_failure_rate numeric(6,5) NOT NULL DEFAULT 0.05000 CHECK (sla_max_failure_rate >= 0 AND sla_max_failure_rate <= 1),
  sla_max_queue_depth integer NOT NULL DEFAULT 500 CHECK (sla_max_queue_depth BETWEEN 1 AND 100000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.subscription_email_runtime_config (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_subscription_email_runtime_config_updated_at'
      AND tgrelid = 'public.subscription_email_runtime_config'::regclass
  ) THEN
    CREATE TRIGGER trg_subscription_email_runtime_config_updated_at
      BEFORE UPDATE ON public.subscription_email_runtime_config
      FOR EACH ROW
      EXECUTE FUNCTION public.tg_set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.subscription_email_queue (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('warning_7d', 'warning_1d', 'expired')),
  event_due_date date NOT NULL,
  period_end_date date NOT NULL,
  period_end_iso timestamptz,
  email text NOT NULL,
  locale text NOT NULL DEFAULT 'ru',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  sent_at timestamptz,
  dead_letter_at timestamptz,
  last_error text,
  last_http_status integer,
  last_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_email_queue_status_available
  ON public.subscription_email_queue (status, available_at, id);

CREATE INDEX IF NOT EXISTS idx_subscription_email_queue_processing_locked
  ON public.subscription_email_queue (locked_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_subscription_email_queue_company_created
  ON public.subscription_email_queue (company_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_subscription_email_queue_updated_at'
      AND tgrelid = 'public.subscription_email_queue'::regclass
  ) THEN
    CREATE TRIGGER trg_subscription_email_queue_updated_at
      BEFORE UPDATE ON public.subscription_email_queue
      FOR EACH ROW
      EXECUTE FUNCTION public.tg_set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.subscription_email_dead_letters (
  id bigserial PRIMARY KEY,
  queue_job_id bigint UNIQUE REFERENCES public.subscription_email_queue(id) ON DELETE SET NULL,
  company_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  event_type text NOT NULL,
  event_due_date date NOT NULL,
  period_end_date date NOT NULL,
  email text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL,
  last_error text,
  last_http_status integer,
  last_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_email_dead_letters_created
  ON public.subscription_email_dead_letters (created_at DESC);

CREATE OR REPLACE FUNCTION public.subscription_email_retry_delay(
  p_attempt integer
)
RETURNS interval
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg public.subscription_email_runtime_config%ROWTYPE;
  v_attempt integer := GREATEST(1, COALESCE(p_attempt, 1));
  v_exp numeric;
  v_delay_seconds integer;
BEGIN
  SELECT * INTO v_cfg
  FROM public.subscription_email_runtime_config
  WHERE id = true;

  v_exp := power(2::numeric, LEAST(20, v_attempt - 1));
  v_delay_seconds := LEAST(
    COALESCE(v_cfg.backoff_cap_seconds, 21600),
    GREATEST(1, COALESCE(v_cfg.backoff_base_seconds, 60)) * v_exp
  )::integer;

  RETURN make_interval(secs => v_delay_seconds);
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_due_subscription_email_jobs(
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(enqueued_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
BEGIN
  RETURN QUERY
  WITH cfg AS (
    SELECT
      COALESCE(rc.warning_catchup_days, 3) AS warning_catchup_days,
      COALESCE(rc.expired_catchup_days, 30) AS expired_catchup_days,
      COALESCE(rc.max_attempts, 8) AS max_attempts,
      COALESCE(rc.enabled, true) AS enabled
    FROM public.subscription_email_runtime_config rc
    WHERE rc.id = true
  ),
  subs AS (
    SELECT
      cs.company_id,
      cs.current_period_end,
      (date_trunc('day', cs.current_period_end AT TIME ZONE 'UTC')::date) AS period_end_date
    FROM public.company_subscriptions cs
    WHERE cs.company_id IS NOT NULL
      AND cs.current_period_end IS NOT NULL
  ),
  events AS (
    SELECT
      s.company_id,
      s.current_period_end,
      s.period_end_date,
      e.event_type,
      e.event_due_date,
      e.default_days_left
    FROM subs s
    CROSS JOIN LATERAL (
      VALUES
        ('warning_7d'::text, (s.period_end_date - 7), 7),
        ('warning_1d'::text, (s.period_end_date - 1), 1),
        ('expired'::text, s.period_end_date, 0)
    ) AS e(event_type, event_due_date, default_days_left)
  ),
  due_events AS (
    SELECT
      e.*,
      ((date_trunc('day', e.current_period_end AT TIME ZONE 'UTC')::date) - (v_now AT TIME ZONE 'UTC')::date)::int AS days_left_today
    FROM events e
    CROSS JOIN cfg
    WHERE cfg.enabled = true
      AND e.event_due_date <= (v_now AT TIME ZONE 'UTC')::date
      AND (
        (e.event_type = 'expired' AND e.event_due_date >= (v_now AT TIME ZONE 'UTC')::date - cfg.expired_catchup_days)
        OR
        (e.event_type IN ('warning_7d', 'warning_1d') AND e.event_due_date >= (v_now AT TIME ZONE 'UTC')::date - cfg.warning_catchup_days)
      )
  ),
  admins AS (
    SELECT
      p.id AS profile_id,
      p.company_id,
      COALESCE(NULLIF(trim(COALESCE(p.first_name, '')), ''), '') AS first_name,
      COALESCE(NULLIF(trim(COALESCE(p.last_name, '')), ''), '') AS last_name,
      CASE WHEN lower(COALESCE(p.locale, 'ru')) LIKE 'en%' THEN 'en' ELSE 'ru' END AS lang,
      NULLIF(trim(COALESCE((to_jsonb(p)->>'email'), '')), '') AS profile_email,
      CASE
        WHEN COALESCE((to_jsonb(p)->>'user_id'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN ((to_jsonb(p)->>'user_id')::uuid)
        ELSE p.id
      END AS auth_user_id
    FROM public.profiles p
    WHERE p.company_id IS NOT NULL
      AND lower(COALESCE(p.role, '')) = 'admin'
      AND COALESCE(p.is_suspended, false) = false
      AND COALESCE(p.is_admin_blocked, false) = false
  ),
  targets AS (
    SELECT
      de.company_id,
      a.profile_id AS recipient_user_id,
      de.event_type,
      de.event_due_date,
      de.period_end_date,
      de.current_period_end,
      a.lang,
      a.first_name,
      a.last_name,
      COALESCE(NULLIF(trim(au.email), ''), a.profile_email) AS email,
      COALESCE(c.name, '') AS company_name,
      CASE
        WHEN de.event_type = 'warning_7d' THEN 7
        WHEN de.event_type = 'warning_1d' THEN 1
        ELSE GREATEST(0, de.days_left_today)
      END AS days_left_for_template
    FROM due_events de
    JOIN admins a ON a.company_id = de.company_id
    LEFT JOIN auth.users au ON au.id = a.auth_user_id
    LEFT JOIN public.companies c ON c.id = de.company_id
    WHERE COALESCE(NULLIF(trim(au.email), ''), a.profile_email) IS NOT NULL
  ),
  ins AS (
    INSERT INTO public.subscription_email_queue (
      company_id,
      recipient_user_id,
      event_type,
      event_due_date,
      period_end_date,
      period_end_iso,
      email,
      locale,
      payload,
      dedupe_key,
      max_attempts
    )
    SELECT
      t.company_id,
      t.recipient_user_id,
      t.event_type,
      t.event_due_date,
      t.period_end_date,
      t.current_period_end,
      t.email,
      t.lang,
      jsonb_build_object(
        'first_name', t.first_name,
        'last_name', t.last_name,
        'company_name', t.company_name,
        'days_left', t.days_left_for_template,
        'period_end_iso', t.current_period_end,
        'event_due_date', t.event_due_date
      ),
      'subscription_email:' || t.company_id::text || ':' || t.recipient_user_id::text || ':' || t.event_type || ':' || t.period_end_date::text,
      (SELECT max_attempts FROM cfg LIMIT 1)
    FROM targets t
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*)::integer AS enqueued_count
  FROM ins;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_subscription_email_jobs(
  p_limit integer DEFAULT 100,
  p_processing_timeout interval DEFAULT interval '15 minutes'
)
RETURNS SETOF public.subscription_email_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(500, GREATEST(1, COALESCE(p_limit, 100)));
  v_timeout interval := COALESCE(p_processing_timeout, interval '15 minutes');
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT q.id
    FROM public.subscription_email_queue q
    WHERE (
      q.status = 'pending'
      AND q.available_at <= now()
    )
    OR (
      q.status = 'processing'
      AND q.locked_at IS NOT NULL
      AND q.locked_at <= now() - v_timeout
    )
    ORDER BY q.available_at, q.id
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.subscription_email_queue q
  SET
    status = 'processing',
    attempt_count = q.attempt_count + 1,
    locked_at = now(),
    updated_at = now()
  FROM picked
  WHERE q.id = picked.id
  RETURNING q.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_subscription_email_job(
  p_job_id bigint,
  p_success boolean,
  p_error text DEFAULT NULL,
  p_http_status integer DEFAULT NULL,
  p_response jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.subscription_email_queue%ROWTYPE;
  v_retry_delay interval;
BEGIN
  SELECT * INTO v_job
  FROM public.subscription_email_queue
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(p_success, false) THEN
    UPDATE public.subscription_email_queue
    SET
      status = 'sent',
      sent_at = now(),
      locked_at = NULL,
      dead_letter_at = NULL,
      last_error = NULL,
      last_http_status = p_http_status,
      last_response = p_response,
      updated_at = now()
    WHERE id = v_job.id;

    INSERT INTO public.subscription_email_notifications (
      company_id,
      recipient_user_id,
      event_type,
      period_end_date,
      email,
      locale,
      payload,
      sent_at
    )
    VALUES (
      v_job.company_id,
      v_job.recipient_user_id,
      v_job.event_type,
      v_job.period_end_date,
      v_job.email,
      v_job.locale,
      COALESCE(v_job.payload, '{}'::jsonb) || jsonb_build_object(
        'queue_job_id', v_job.id,
        'attempt_count', v_job.attempt_count,
        'http_status', p_http_status,
        'response', COALESCE(p_response, '{}'::jsonb)
      ),
      now()
    )
    ON CONFLICT (company_id, recipient_user_id, event_type, period_end_date)
    DO UPDATE
    SET
      email = EXCLUDED.email,
      locale = EXCLUDED.locale,
      payload = EXCLUDED.payload,
      sent_at = EXCLUDED.sent_at;

    RETURN;
  END IF;

  IF v_job.attempt_count >= v_job.max_attempts THEN
    UPDATE public.subscription_email_queue
    SET
      status = 'dead_letter',
      dead_letter_at = now(),
      locked_at = NULL,
      last_error = LEFT(COALESCE(p_error, 'unknown error'), 4000),
      last_http_status = p_http_status,
      last_response = p_response,
      updated_at = now()
    WHERE id = v_job.id;

    INSERT INTO public.subscription_email_dead_letters (
      queue_job_id,
      company_id,
      recipient_user_id,
      event_type,
      event_due_date,
      period_end_date,
      email,
      payload,
      attempt_count,
      last_error,
      last_http_status,
      last_response
    )
    VALUES (
      v_job.id,
      v_job.company_id,
      v_job.recipient_user_id,
      v_job.event_type,
      v_job.event_due_date,
      v_job.period_end_date,
      v_job.email,
      COALESCE(v_job.payload, '{}'::jsonb),
      v_job.attempt_count,
      LEFT(COALESCE(p_error, 'unknown error'), 4000),
      p_http_status,
      p_response
    )
    ON CONFLICT (queue_job_id) DO UPDATE
    SET
      attempt_count = EXCLUDED.attempt_count,
      last_error = EXCLUDED.last_error,
      last_http_status = EXCLUDED.last_http_status,
      last_response = EXCLUDED.last_response;

    RETURN;
  END IF;

  v_retry_delay := public.subscription_email_retry_delay(v_job.attempt_count);

  UPDATE public.subscription_email_queue
  SET
    status = 'pending',
    available_at = now() + v_retry_delay,
    locked_at = NULL,
    last_error = LEFT(COALESCE(p_error, 'unknown error'), 4000),
    last_http_status = p_http_status,
    last_response = p_response,
    updated_at = now()
  WHERE id = v_job.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.requeue_subscription_email_job(
  p_job_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.subscription_email_queue
  SET
    status = 'pending',
    available_at = now(),
    locked_at = NULL,
    dead_letter_at = NULL,
    last_error = NULL,
    updated_at = now()
  WHERE id = p_job_id
    AND status = 'dead_letter';

  IF FOUND THEN
    DELETE FROM public.subscription_email_dead_letters
    WHERE queue_job_id = p_job_id;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE VIEW public.subscription_email_sla_metrics AS
WITH agg AS (
  SELECT
    COUNT(*) FILTER (WHERE q.status = 'pending' AND q.available_at <= now())::bigint AS queue_ready_count,
    COUNT(*) FILTER (WHERE q.status = 'pending')::bigint AS queue_pending_total,
    COUNT(*) FILTER (WHERE q.status = 'processing')::bigint AS queue_processing_count,
    COUNT(*) FILTER (WHERE q.status = 'processing' AND q.locked_at < now() - interval '15 minutes')::bigint AS processing_stuck_count,
    COUNT(*) FILTER (WHERE q.status = 'dead_letter' AND q.dead_letter_at >= now() - interval '24 hours')::bigint AS dead_letters_24h,
    COUNT(*) FILTER (WHERE q.sent_at >= now() - interval '24 hours')::bigint AS sent_24h,
    COUNT(*) FILTER (WHERE q.created_at >= now() - interval '24 hours')::bigint AS created_24h,
    COALESCE(MAX(EXTRACT(EPOCH FROM (now() - q.available_at))) FILTER (WHERE q.status = 'pending' AND q.available_at <= now()), 0)::bigint AS oldest_ready_age_seconds,
    COALESCE(
      percentile_disc(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (q.sent_at - q.created_at)))
      FILTER (WHERE q.sent_at IS NOT NULL AND q.sent_at >= now() - interval '24 hours'),
      0
    )::bigint AS p95_delivery_lag_seconds
  FROM public.subscription_email_queue q
)
SELECT
  now() AS measured_at,
  a.queue_ready_count,
  a.queue_pending_total,
  a.queue_processing_count,
  a.processing_stuck_count,
  a.dead_letters_24h,
  a.sent_24h,
  a.created_24h,
  a.oldest_ready_age_seconds,
  a.p95_delivery_lag_seconds,
  CASE
    WHEN (a.sent_24h + a.dead_letters_24h) = 0 THEN 0::numeric
    ELSE (a.dead_letters_24h::numeric / (a.sent_24h + a.dead_letters_24h)::numeric)
  END AS failure_rate_24h
FROM agg a;

CREATE OR REPLACE FUNCTION public.get_subscription_email_sla_breaches()
RETURNS TABLE(metric text, value numeric, threshold numeric, severity text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg public.subscription_email_runtime_config%ROWTYPE;
  v public.subscription_email_sla_metrics%ROWTYPE;
BEGIN
  SELECT * INTO v_cfg
  FROM public.subscription_email_runtime_config
  WHERE id = true;

  SELECT * INTO v
  FROM public.subscription_email_sla_metrics;

  IF v.queue_ready_count > COALESCE(v_cfg.sla_max_queue_depth, 500) THEN
    RETURN QUERY SELECT
      'queue_ready_count'::text,
      v.queue_ready_count::numeric,
      COALESCE(v_cfg.sla_max_queue_depth, 500)::numeric,
      'high'::text,
      'Subscription email queue depth is above threshold'::text;
  END IF;

  IF v.p95_delivery_lag_seconds > COALESCE(v_cfg.sla_max_delivery_lag_minutes, 30) * 60 THEN
    RETURN QUERY SELECT
      'p95_delivery_lag_seconds'::text,
      v.p95_delivery_lag_seconds::numeric,
      (COALESCE(v_cfg.sla_max_delivery_lag_minutes, 30) * 60)::numeric,
      'high'::text,
      'Subscription email delivery lag p95 is above threshold'::text;
  END IF;

  IF v.failure_rate_24h > COALESCE(v_cfg.sla_max_failure_rate, 0.05) THEN
    RETURN QUERY SELECT
      'failure_rate_24h'::text,
      v.failure_rate_24h,
      COALESCE(v_cfg.sla_max_failure_rate, 0.05),
      'critical'::text,
      'Subscription email failure rate is above threshold'::text;
  END IF;

  IF v.processing_stuck_count > 0 THEN
    RETURN QUERY SELECT
      'processing_stuck_count'::text,
      v.processing_stuck_count::numeric,
      0::numeric,
      'medium'::text,
      'Subscription email queue has stuck processing jobs'::text;
  END IF;
END;
$$;

ALTER TABLE public.subscription_email_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_email_dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_email_runtime_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_email_queue_service_role_all ON public.subscription_email_queue;
CREATE POLICY subscription_email_queue_service_role_all
ON public.subscription_email_queue
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS subscription_email_dead_letters_service_role_all ON public.subscription_email_dead_letters;
CREATE POLICY subscription_email_dead_letters_service_role_all
ON public.subscription_email_dead_letters
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS subscription_email_runtime_config_service_role_read ON public.subscription_email_runtime_config;
CREATE POLICY subscription_email_runtime_config_service_role_read
ON public.subscription_email_runtime_config
FOR SELECT
TO service_role
USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_email_queue TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_email_dead_letters TO service_role;
GRANT SELECT ON public.subscription_email_runtime_config TO service_role;
GRANT SELECT ON public.subscription_email_sla_metrics TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.subscription_email_queue_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.subscription_email_dead_letters_id_seq TO service_role;

GRANT EXECUTE ON FUNCTION public.subscription_email_retry_delay(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_subscription_email_jobs(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_subscription_email_jobs(integer, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_subscription_email_job(bigint, boolean, text, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_subscription_email_job(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_subscription_email_sla_breaches() TO service_role;

COMMIT;
