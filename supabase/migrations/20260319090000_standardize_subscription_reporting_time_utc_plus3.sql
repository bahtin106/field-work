BEGIN;

CREATE OR REPLACE FUNCTION public.subscription_reporting_timestamp(p_value timestamptz)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    ELSE ((date_trunc('day', p_value AT TIME ZONE 'UTC') + time '09:00:00') AT TIME ZONE 'UTC')
  END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_company_subscription(p_company_id uuid)
RETURNS public.company_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
  v_sub public.company_subscriptions%ROWTYPE;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION 'company not found: %', p_company_id;
  END IF;

  SELECT id INTO v_plan_id
  FROM public.billing_plans
  WHERE code = 'subscription_base'
  LIMIT 1;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'base plan not found';
  END IF;

  SELECT * INTO v_sub
  FROM public.company_subscriptions
  WHERE company_id = p_company_id
  LIMIT 1;

  IF v_sub.id IS NULL THEN
    INSERT INTO public.company_subscriptions (
      company_id,
      plan_id,
      status,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      grace_period_days,
      source
    ) VALUES (
      p_company_id,
      v_plan_id,
      'active',
      now(),
      public.subscription_reporting_timestamp(now() + interval '14 days'),
      false,
      0,
      'manual'
    )
    RETURNING * INTO v_sub;
  END IF;

  IF v_sub.current_period_end IS NOT NULL
     AND v_sub.current_period_end <> public.subscription_reporting_timestamp(v_sub.current_period_end)
  THEN
    UPDATE public.company_subscriptions
    SET
      current_period_end = public.subscription_reporting_timestamp(current_period_end),
      status = CASE WHEN public.subscription_reporting_timestamp(current_period_end) >= now() THEN 'active' ELSE 'expired' END,
      updated_at = now()
    WHERE id = v_sub.id
    RETURNING * INTO v_sub;
  ELSIF v_sub.status <> (CASE WHEN v_sub.current_period_end >= now() THEN 'active' ELSE 'expired' END) THEN
    UPDATE public.company_subscriptions
    SET
      status = CASE WHEN current_period_end >= now() THEN 'active' ELSE 'expired' END,
      updated_at = now()
    WHERE id = v_sub.id
    RETURNING * INTO v_sub;
  END IF;

  RETURN v_sub;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_company_subscription_super(
  p_company_id uuid,
  p_plan_code text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_period_end timestamptz DEFAULT NULL,
  p_grace_period_days int DEFAULT NULL,
  p_extra_seats int DEFAULT NULL,
  p_extra_storage_gb int DEFAULT NULL,
  p_cancel_at_period_end boolean DEFAULT NULL,
  p_addons_json jsonb DEFAULT NULL
)
RETURNS public.company_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.company_subscriptions%ROWTYPE;
  v_sub public.company_subscriptions%ROWTYPE;
  v_status text;
  v_period_end timestamptz;
  v_cancel_at_period_end boolean;
  v_addon_extra_seat uuid;
  v_plan_id uuid;
  v_paid_total int;
  v_effective_extra_seats int;
  v_existing_extra_seats int;
  v_is_expired_now boolean := false;
  v_was_active boolean := false;
  v_will_be_active boolean := false;
BEGIN
  PERFORM public.admin_assert_super_admin();

  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION 'company not found: %', p_company_id;
  END IF;

  SELECT id INTO v_plan_id
  FROM public.billing_plans
  WHERE code = 'subscription_base'
  LIMIT 1;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'base plan not found';
  END IF;

  v_existing := public.ensure_company_subscription(p_company_id);
  v_existing_extra_seats := GREATEST(0, COALESCE(v_existing.paid_seats_total, 1) - 1);
  v_is_expired_now := v_existing.current_period_end IS NULL OR v_existing.current_period_end < now();
  v_was_active := NOT v_is_expired_now;

  v_period_end := public.subscription_reporting_timestamp(
    COALESCE(p_period_end, v_existing.current_period_end, now() + interval '30 days')
  );
  v_status := COALESCE(
    CASE WHEN p_status IN ('active', 'expired') THEN p_status ELSE NULL END,
    CASE WHEN v_period_end >= now() THEN 'active' ELSE 'expired' END
  );
  v_cancel_at_period_end := COALESCE(p_cancel_at_period_end, v_existing.cancel_at_period_end, false);
  v_will_be_active := v_period_end > now();

  v_effective_extra_seats := p_extra_seats;
  IF p_extra_seats IS NOT NULL
     AND p_extra_seats = 0
     AND v_existing_extra_seats > 0
     AND (
       (NOT v_was_active AND v_will_be_active)
       OR (v_was_active AND NOT v_will_be_active)
     )
  THEN
    v_effective_extra_seats := v_existing_extra_seats;
  END IF;

  INSERT INTO public.company_subscriptions (
    company_id,
    plan_id,
    status,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    grace_period_days,
    source
  ) VALUES (
    p_company_id,
    v_plan_id,
    v_status,
    COALESCE(v_existing.current_period_start, now()),
    v_period_end,
    v_cancel_at_period_end,
    0,
    'admin'
  )
  ON CONFLICT (company_id)
  DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    grace_period_days = 0,
    source = 'admin',
    updated_at = now()
  RETURNING * INTO v_sub;

  SELECT id INTO v_addon_extra_seat
  FROM public.billing_addons
  WHERE code = 'extra_seat'
  LIMIT 1;

  IF v_addon_extra_seat IS NOT NULL AND v_effective_extra_seats IS NOT NULL THEN
    DELETE FROM public.company_subscription_addons
    WHERE subscription_id = v_sub.id
      AND addon_id = v_addon_extra_seat;

    IF v_effective_extra_seats > 0 THEN
      INSERT INTO public.company_subscription_addons(subscription_id, addon_id, quantity)
      VALUES (v_sub.id, v_addon_extra_seat, v_effective_extra_seats)
      ON CONFLICT (subscription_id, addon_id)
      DO UPDATE SET quantity = EXCLUDED.quantity;
    END IF;
  END IF;

  IF v_effective_extra_seats IS NOT NULL THEN
    v_paid_total := GREATEST(1, 1 + GREATEST(0, v_effective_extra_seats));
    UPDATE public.company_subscriptions
    SET
      paid_seats_total = v_paid_total,
      paid_seats_additional = GREATEST(0, v_paid_total - 1),
      updated_at = now()
    WHERE company_id = p_company_id
    RETURNING * INTO v_sub;

    PERFORM public.enforce_seat_limit(p_company_id);
  END IF;

  PERFORM public.repair_company_seat_pool(p_company_id);

  RETURN v_sub;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_company_subscription_super(uuid, text, text, timestamptz, int, int, int, boolean, jsonb) TO authenticated;

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
      public.subscription_reporting_timestamp(cs.current_period_end) AS period_end_at,
      (public.subscription_reporting_timestamp(cs.current_period_end) AT TIME ZONE 'UTC')::date AS period_end_date,
      COALESCE(c.name, '') AS company_name
    FROM public.company_subscriptions cs
    CROSS JOIN cfg
    LEFT JOIN public.companies c ON c.id = cs.company_id
    WHERE cfg.enabled = true
      AND cs.company_id IS NOT NULL
      AND cs.current_period_end IS NOT NULL
      AND (
        public.subscription_reporting_timestamp(cs.current_period_end) BETWEEN (v_now - make_interval(days => cfg.expired_catchup_days)) AND v_now
        OR public.subscription_reporting_timestamp(cs.current_period_end) BETWEEN (v_now + interval '1 day' - make_interval(days => cfg.warning_catchup_days)) AND (v_now + interval '1 day')
        OR public.subscription_reporting_timestamp(cs.current_period_end) BETWEEN (v_now + interval '7 days' - make_interval(days => cfg.warning_catchup_days)) AND (v_now + interval '7 days')
      )
  ),
  events AS (
    SELECT
      s.company_id,
      s.period_end_at,
      s.period_end_date,
      s.company_name,
      e.event_type,
      e.event_due_at,
      (e.event_due_at AT TIME ZONE 'UTC')::date AS event_due_date,
      e.default_days_left
    FROM candidate_subs s
    CROSS JOIN LATERAL (
      VALUES
        ('warning_7d'::text, (s.period_end_at - interval '7 days'), 7),
        ('warning_1d'::text, (s.period_end_at - interval '1 day'), 1),
        ('expired'::text, s.period_end_at, 0)
    ) AS e(event_type, event_due_at, default_days_left)
  ),
  due_events AS (
    SELECT
      e.*,
      CASE
        WHEN e.period_end_at <= v_now THEN 0
        ELSE CEIL(EXTRACT(EPOCH FROM (e.period_end_at - v_now)) / 86400.0)::int
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
      de.period_end_at,
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
      t.period_end_at,
      t.email,
      t.lang,
      jsonb_build_object(
        'first_name', t.first_name,
        'last_name', t.last_name,
        'company_name', t.company_name,
        'days_left', t.days_left_for_template,
        'period_end_iso', t.period_end_at,
        'event_due_at', t.event_due_at
      ),
      'subscription_email:' || t.company_id::text || ':' || t.recipient_user_id::text || ':' || t.event_type || ':' || t.period_end_at::text,
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

DROP TRIGGER IF EXISTS trg_company_subscriptions_period_end_reporting ON public.company_subscriptions;

CREATE OR REPLACE FUNCTION public.tg_company_subscriptions_normalize_period_end()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_period_end IS NOT NULL THEN
    NEW.current_period_end := public.subscription_reporting_timestamp(NEW.current_period_end);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_company_subscriptions_period_end_reporting
  BEFORE INSERT OR UPDATE OF current_period_end
  ON public.company_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_company_subscriptions_normalize_period_end();

UPDATE public.company_subscriptions cs
SET
  current_period_end = public.subscription_reporting_timestamp(cs.current_period_end),
  status = CASE
    WHEN public.subscription_reporting_timestamp(cs.current_period_end) >= now() THEN 'active'
    ELSE 'expired'
  END,
  updated_at = now()
WHERE cs.current_period_end IS NOT NULL
  AND (
    cs.current_period_end <> public.subscription_reporting_timestamp(cs.current_period_end)
    OR cs.status <> CASE WHEN public.subscription_reporting_timestamp(cs.current_period_end) >= now() THEN 'active' ELSE 'expired' END
  );

WITH queue_norm AS (
  SELECT
    q.id,
    public.subscription_reporting_timestamp(
      COALESCE(
        q.period_end_iso,
        (q.period_end_date::timestamp AT TIME ZONE 'UTC')
      )
    ) AS norm_period_end
  FROM public.subscription_email_queue q
  WHERE q.status <> 'sent'
)
UPDATE public.subscription_email_queue q
SET
  period_end_iso = n.norm_period_end,
  period_end_date = (n.norm_period_end AT TIME ZONE 'UTC')::date,
  event_due_at = CASE
    WHEN q.event_type = 'warning_7d' THEN n.norm_period_end - interval '7 days'
    WHEN q.event_type = 'warning_1d' THEN n.norm_period_end - interval '1 day'
    ELSE n.norm_period_end
  END,
  event_due_date = (
    CASE
      WHEN q.event_type = 'warning_7d' THEN n.norm_period_end - interval '7 days'
      WHEN q.event_type = 'warning_1d' THEN n.norm_period_end - interval '1 day'
      ELSE n.norm_period_end
    END AT TIME ZONE 'UTC'
  )::date,
  payload = COALESCE(q.payload, '{}'::jsonb)
    - 'company_timezone'
    || jsonb_build_object(
      'period_end_iso', n.norm_period_end,
      'event_due_at', CASE
        WHEN q.event_type = 'warning_7d' THEN n.norm_period_end - interval '7 days'
        WHEN q.event_type = 'warning_1d' THEN n.norm_period_end - interval '1 day'
        ELSE n.norm_period_end
      END
    ),
  dedupe_key = 'subscription_email:' || q.company_id::text || ':' || q.recipient_user_id::text || ':' || q.event_type || ':' || n.norm_period_end::text,
  updated_at = now()
FROM queue_norm n
WHERE q.id = n.id
  AND n.norm_period_end IS NOT NULL;

COMMIT;
