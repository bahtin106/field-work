BEGIN;

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
        -- The app keeps the subscription active through the displayed UTC end date,
        -- so the expired notification must be queued only on the following UTC day.
        ('expired'::text, (s.period_end_date + 1), 0)
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

COMMIT;
