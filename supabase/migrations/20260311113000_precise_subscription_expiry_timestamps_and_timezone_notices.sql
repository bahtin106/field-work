BEGIN;

ALTER TABLE public.subscription_email_queue
  ADD COLUMN IF NOT EXISTS event_due_at timestamptz;

ALTER TABLE public.subscription_email_dead_letters
  ADD COLUMN IF NOT EXISTS event_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS period_end_iso timestamptz;

ALTER TABLE public.subscription_email_notifications
  ADD COLUMN IF NOT EXISTS period_end_iso timestamptz;

UPDATE public.subscription_email_queue
SET event_due_at = CASE
  WHEN period_end_iso IS NOT NULL AND event_type = 'warning_7d' THEN period_end_iso - interval '7 days'
  WHEN period_end_iso IS NOT NULL AND event_type = 'warning_1d' THEN period_end_iso - interval '1 day'
  WHEN period_end_iso IS NOT NULL THEN period_end_iso
  ELSE event_due_date::timestamp AT TIME ZONE 'UTC'
END
WHERE event_due_at IS NULL;

UPDATE public.subscription_email_dead_letters
SET
  event_due_at = CASE
    WHEN period_end_iso IS NOT NULL AND event_type = 'warning_7d' THEN period_end_iso - interval '7 days'
    WHEN period_end_iso IS NOT NULL AND event_type = 'warning_1d' THEN period_end_iso - interval '1 day'
    WHEN period_end_iso IS NOT NULL THEN period_end_iso
    ELSE event_due_date::timestamp AT TIME ZONE 'UTC'
  END,
  period_end_iso = COALESCE(
    period_end_iso,
    CASE
      WHEN period_end_date IS NOT NULL
        THEN ((period_end_date::timestamp + time '23:59:59.999') AT TIME ZONE 'UTC')
      ELSE NULL
    END
  )
WHERE event_due_at IS NULL
   OR period_end_iso IS NULL;

UPDATE public.subscription_email_notifications
SET period_end_iso = COALESCE(
  period_end_iso,
  NULLIF(payload->>'period_end_iso', '')::timestamptz,
  ((period_end_date::timestamp + time '23:59:59.999') AT TIME ZONE 'UTC')
)
WHERE period_end_iso IS NULL;

ALTER TABLE public.subscription_email_queue
  ALTER COLUMN event_due_at SET NOT NULL;

ALTER TABLE public.subscription_email_dead_letters
  ALTER COLUMN event_due_at SET NOT NULL,
  ALTER COLUMN period_end_iso SET NOT NULL;

ALTER TABLE public.subscription_email_notifications
  ALTER COLUMN period_end_iso SET NOT NULL;

DROP INDEX IF EXISTS subscription_email_notifications_unique_event;

CREATE UNIQUE INDEX IF NOT EXISTS subscription_email_notifications_unique_event
  ON public.subscription_email_notifications (company_id, recipient_user_id, event_type, period_end_iso);

CREATE OR REPLACE FUNCTION public.get_company_entitlements(p_company_id uuid)
RETURNS TABLE(
  company_id uuid,
  is_owner boolean,
  plan_code text,
  plan_name text,
  status text,
  current_period_end timestamptz,
  grace_period_days int,
  can_edit boolean,
  days_left int,
  allowed_seats int,
  used_seats int,
  allowed_storage_gb int,
  used_storage_gb numeric,
  features jsonb,
  addons jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_member boolean;
  v_is_owner boolean;
  v_sub public.company_subscriptions%ROWTYPE;
  v_policy text;
BEGIN
  v_is_member := public.is_company_member(p_company_id);
  v_is_owner := public.is_company_owner(p_company_id);

  IF NOT v_is_member AND NOT v_is_owner THEN
    RAISE EXCEPTION 'access denied to company %', p_company_id USING ERRCODE = '42501';
  END IF;

  v_sub := public.ensure_company_subscription(p_company_id);
  v_policy := public.company_seat_overlimit_policy(p_company_id);

  RETURN QUERY
  WITH used AS (
    SELECT public.company_used_seats(p_company_id) AS used_seats,
           0::numeric AS used_storage_gb
  ),
  addon_rows AS (
    SELECT ba.code, ba.unit, csa.quantity, ba.config
    FROM public.company_subscription_addons csa
    JOIN public.billing_addons ba ON ba.id = csa.addon_id
    WHERE csa.subscription_id = v_sub.id
  ),
  addon_agg AS (
    SELECT
      COALESCE(SUM(CASE WHEN code = 'extra_seat' THEN quantity ELSE 0 END), 0)::int AS extra_seats,
      COALESCE(
        jsonb_object_agg(code, jsonb_build_object('unit', unit, 'quantity', quantity, 'config', config))
          FILTER (WHERE code IS NOT NULL),
        '{}'::jsonb
      ) AS addons_json
    FROM addon_rows
  )
  SELECT
    p_company_id AS company_id,
    v_is_owner AS is_owner,
    CASE WHEN v_is_owner THEN 'subscription_base' ELSE NULL END AS plan_code,
    CASE WHEN v_is_owner THEN 'Subscription' ELSE NULL END AS plan_name,
    CASE WHEN v_sub.current_period_end >= now() THEN 'active' ELSE 'expired' END AS status,
    v_sub.current_period_end,
    0 AS grace_period_days,
    public.billing_can_edit_company(p_company_id) AS can_edit,
    CASE
      WHEN v_sub.current_period_end IS NULL OR v_sub.current_period_end <= now() THEN 0
      ELSE CEIL(EXTRACT(EPOCH FROM (v_sub.current_period_end - now())) / 86400.0)::int
    END AS days_left,
    CASE WHEN v_is_owner THEN (1 + COALESCE(a.extra_seats, 0))::int ELSE NULL END AS allowed_seats,
    u.used_seats,
    NULL::int AS allowed_storage_gb,
    u.used_storage_gb,
    jsonb_build_object(
      'seat_policy', v_policy,
      'is_over_limit', (u.used_seats > (1 + COALESCE(a.extra_seats, 0))),
      'over_limit_by', GREATEST(0, u.used_seats - (1 + COALESCE(a.extra_seats, 0))),
      'can_add_members', public.can_company_add_member(p_company_id)
    ) AS features,
    CASE WHEN v_is_owner THEN a.addons_json ELSE '{}'::jsonb END AS addons
  FROM used u
  CROSS JOIN addon_agg a;
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
      (date_trunc('day', cs.current_period_end AT TIME ZONE 'UTC')::date) AS period_end_date,
      COALESCE(NULLIF(trim(c.timezone), ''), 'UTC') AS company_timezone,
      COALESCE(c.name, '') AS company_name
    FROM public.company_subscriptions cs
    LEFT JOIN public.companies c ON c.id = cs.company_id
    WHERE cs.company_id IS NOT NULL
      AND cs.current_period_end IS NOT NULL
  ),
  events AS (
    SELECT
      s.company_id,
      s.current_period_end,
      s.period_end_date,
      s.company_timezone,
      s.company_name,
      e.event_type,
      e.event_due_at,
      (e.event_due_at AT TIME ZONE 'UTC')::date AS event_due_date,
      e.default_days_left
    FROM subs s
    CROSS JOIN LATERAL (
      VALUES
        ('warning_7d'::text, (s.current_period_end - interval '7 days'), 7),
        ('warning_1d'::text, (s.current_period_end - interval '1 day'), 1),
        ('expired'::text, s.current_period_end, 0)
    ) AS e(event_type, event_due_at, default_days_left)
  ),
  due_events AS (
    SELECT
      e.*,
      CASE
        WHEN e.current_period_end <= v_now THEN 0
        ELSE CEIL(EXTRACT(EPOCH FROM (e.current_period_end - v_now)) / 86400.0)::int
      END AS days_left_now
    FROM events e
    CROSS JOIN cfg
    WHERE cfg.enabled = true
      AND e.event_due_at <= v_now
      AND (
        (e.event_type = 'expired' AND e.event_due_at >= v_now - make_interval(days => cfg.expired_catchup_days))
        OR
        (e.event_type IN ('warning_7d', 'warning_1d') AND e.event_due_at >= v_now - make_interval(days => cfg.warning_catchup_days))
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
      de.event_due_at,
      de.event_due_date,
      de.period_end_date,
      de.current_period_end,
      de.company_timezone,
      a.lang,
      a.first_name,
      a.last_name,
      COALESCE(NULLIF(trim(au.email), ''), a.profile_email) AS email,
      de.company_name,
      CASE
        WHEN de.event_type = 'warning_7d' THEN 7
        WHEN de.event_type = 'warning_1d' THEN 1
        ELSE GREATEST(0, de.days_left_now)
      END AS days_left_for_template
    FROM due_events de
    JOIN admins a ON a.company_id = de.company_id
    LEFT JOIN auth.users au ON au.id = a.auth_user_id
    WHERE COALESCE(NULLIF(trim(au.email), ''), a.profile_email) IS NOT NULL
  ),
  ins AS (
    INSERT INTO public.subscription_email_queue (
      company_id,
      recipient_user_id,
      event_type,
      event_due_date,
      event_due_at,
      period_end_date,
      period_end_iso,
      email,
      locale,
      payload,
      dedupe_key,
      max_attempts,
      available_at
    )
    SELECT
      t.company_id,
      t.recipient_user_id,
      t.event_type,
      t.event_due_date,
      t.event_due_at,
      t.period_end_date,
      t.current_period_end,
      t.email,
      t.lang,
      jsonb_build_object(
        'first_name', t.first_name,
        'last_name', t.last_name,
        'company_name', t.company_name,
        'company_timezone', t.company_timezone,
        'days_left', t.days_left_for_template,
        'period_end_iso', t.current_period_end,
        'event_due_at', t.event_due_at
      ),
      'subscription_email:' || t.company_id::text || ':' || t.recipient_user_id::text || ':' || t.event_type || ':' || t.current_period_end::text,
      (SELECT max_attempts FROM cfg LIMIT 1),
      v_now
    FROM targets t
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*)::integer AS enqueued_count
  FROM ins;
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
      period_end_iso,
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
      v_job.period_end_iso,
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
    ON CONFLICT (company_id, recipient_user_id, event_type, period_end_iso)
    DO UPDATE
    SET
      period_end_date = EXCLUDED.period_end_date,
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
      event_due_at,
      period_end_date,
      period_end_iso,
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
      v_job.event_due_at,
      v_job.period_end_date,
      v_job.period_end_iso,
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
      last_response = EXCLUDED.last_response,
      event_due_at = EXCLUDED.event_due_at,
      period_end_iso = EXCLUDED.period_end_iso;

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

COMMIT;
