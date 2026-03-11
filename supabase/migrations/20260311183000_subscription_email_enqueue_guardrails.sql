BEGIN;

CREATE INDEX IF NOT EXISTS idx_company_subscriptions_current_period_end_company
  ON public.company_subscriptions (current_period_end, company_id)
  WHERE company_id IS NOT NULL
    AND current_period_end IS NOT NULL;

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
  v_has_lock boolean;
BEGIN
  -- Prevent overlapping scheduler ticks from repeatedly scanning all subscriptions.
  SELECT pg_try_advisory_xact_lock(hashtext('subscription_email_enqueue_due_jobs')::bigint)
  INTO v_has_lock;

  IF NOT COALESCE(v_has_lock, false) THEN
    RETURN QUERY SELECT 0::integer;
    RETURN;
  END IF;

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
  candidate_subs AS (
    SELECT
      cs.company_id,
      cs.current_period_end,
      (date_trunc('day', cs.current_period_end AT TIME ZONE 'UTC')::date) AS period_end_date,
      COALESCE(NULLIF(trim(c.timezone), ''), 'UTC') AS company_timezone,
      COALESCE(c.name, '') AS company_name
    FROM public.company_subscriptions cs
    CROSS JOIN cfg
    LEFT JOIN public.companies c ON c.id = cs.company_id
    WHERE cfg.enabled = true
      AND cs.company_id IS NOT NULL
      AND cs.current_period_end IS NOT NULL
      AND (
        cs.current_period_end BETWEEN (v_now - make_interval(days => cfg.expired_catchup_days)) AND v_now
        OR cs.current_period_end BETWEEN (v_now + interval '1 day' - make_interval(days => cfg.warning_catchup_days)) AND (v_now + interval '1 day')
        OR cs.current_period_end BETWEEN (v_now + interval '7 days' - make_interval(days => cfg.warning_catchup_days)) AND (v_now + interval '7 days')
      )
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
    FROM candidate_subs s
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

COMMIT;
