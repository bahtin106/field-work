-- sql/07_subscription_simplification.sql
-- Simplify subscription model: active/expired, 14-day trial bootstrap, paid owner + extra seats.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure a single base subscription plan exists.
INSERT INTO public.billing_plans (
  code,
  name,
  base_price_month,
  included_seats,
  included_storage_gb,
  features,
  is_active
)
VALUES (
  'subscription_base',
  'Subscription',
  NULL,
  1,
  0,
  '{}'::jsonb,
  true
)
ON CONFLICT (code)
DO UPDATE SET
  name = EXCLUDED.name,
  included_seats = 1,
  included_storage_gb = 0,
  is_active = true;

-- Map legacy statuses to the new simplified model.
UPDATE public.company_subscriptions
SET status = CASE
  WHEN current_period_end >= now() THEN 'active'
  ELSE 'expired'
END;

-- Replace legacy status check with active/expired only.
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.company_subscriptions') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.company_subscriptions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.company_subscriptions DROP CONSTRAINT %I', r.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.company_subscriptions'::regclass
      AND conname = 'company_subscriptions_status_check'
  ) THEN
    ALTER TABLE public.company_subscriptions
      ADD CONSTRAINT company_subscriptions_status_check
      CHECK (status IN ('active', 'expired'));
  END IF;
END;
$$;

-- Ensure a company has subscription row; bootstrap with 14-day trial-like active period.
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
      now() + interval '14 days',
      false,
      0,
      'manual'
    )
    RETURNING * INTO v_sub;
  END IF;

  IF v_sub.status <> (CASE WHEN v_sub.current_period_end >= now() THEN 'active' ELSE 'expired' END) THEN
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

-- Read-only gate: editable only while subscription is active.
CREATE OR REPLACE FUNCTION public.billing_can_edit_company(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.company_subscriptions%ROWTYPE;
BEGIN
  IF NOT public.is_company_member(p_company_id) THEN
    RETURN false;
  END IF;

  v_sub := public.ensure_company_subscription(p_company_id);
  RETURN v_sub.current_period_end >= now();
END;
$$;

-- Entitlements: active/expired only, seats = owner + extra seats.
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
BEGIN
  v_is_member := public.is_company_member(p_company_id);
  v_is_owner := public.is_company_owner(p_company_id);

  IF NOT v_is_member AND NOT v_is_owner THEN
    RAISE EXCEPTION 'access denied to company %', p_company_id USING ERRCODE = '42501';
  END IF;

  v_sub := public.ensure_company_subscription(p_company_id);

  RETURN QUERY
  WITH used AS (
    SELECT
      (
        CASE
          WHEN to_regclass('public.company_members') IS NOT NULL
          THEN (
            SELECT COUNT(*)::int
            FROM public.company_members cm
            WHERE cm.company_id = p_company_id
              AND (cm.is_active IS NULL OR cm.is_active = true)
          )
          WHEN to_regclass('public.profiles') IS NOT NULL
          THEN (
            SELECT COUNT(*)::int
            FROM public.profiles p
            WHERE p.company_id = p_company_id
          )
          ELSE 0
        END
      ) AS used_seats,
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
    (v_sub.current_period_end >= now()) AS can_edit,
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_sub.current_period_end - now())) / 86400.0))::int AS days_left,
    CASE WHEN v_is_owner THEN (1 + COALESCE(a.extra_seats, 0))::int ELSE NULL END AS allowed_seats,
    u.used_seats,
    NULL::int AS allowed_storage_gb,
    u.used_storage_gb,
    '{}'::jsonb AS features,
    CASE WHEN v_is_owner THEN a.addons_json ELSE '{}'::jsonb END AS addons
  FROM used u
  CROSS JOIN addon_agg a;
END;
$$;

-- Super-admin list of companies with effective active/expired status.
CREATE OR REPLACE FUNCTION public.admin_list_companies(
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  company_id uuid,
  name text,
  timezone text,
  currency text,
  employees_count int,
  plan_code text,
  subscription_status text,
  current_period_end timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_assert_super_admin();

  RETURN QUERY
  SELECT
    c.id AS company_id,
    c.name,
    c.timezone,
    c.currency,
    public.admin_company_employees_count(c.id) AS employees_count,
    'subscription_base'::text AS plan_code,
    CASE
      WHEN cs.current_period_end IS NOT NULL AND cs.current_period_end >= now() THEN 'active'
      ELSE 'expired'
    END AS subscription_status,
    cs.current_period_end,
    c.updated_at
  FROM public.companies c
  LEFT JOIN public.company_subscriptions cs ON cs.company_id = c.id
  WHERE
    COALESCE(p_search, '') = ''
    OR COALESCE(c.name, '') ILIKE ('%' || p_search || '%')
    OR c.id::text ILIKE ('%' || p_search || '%')
  ORDER BY COALESCE(c.name, c.id::text)
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$$;

-- Super-admin company details with effective active/expired status.
CREATE OR REPLACE FUNCTION public.admin_get_company(p_company_id uuid)
RETURNS TABLE(
  company_id uuid,
  name text,
  timezone text,
  currency text,
  employees_count int,
  plan_code text,
  subscription_status text,
  current_period_end timestamptz,
  grace_period_days int,
  extra_seats int,
  extra_storage_gb int,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_assert_super_admin();
  PERFORM public.ensure_company_subscription(p_company_id);

  RETURN QUERY
  WITH addon_rows AS (
    SELECT ba.code, csa.quantity
    FROM public.company_subscriptions cs
    JOIN public.company_subscription_addons csa ON csa.subscription_id = cs.id
    JOIN public.billing_addons ba ON ba.id = csa.addon_id
    WHERE cs.company_id = p_company_id
  )
  SELECT
    c.id AS company_id,
    c.name,
    c.timezone,
    c.currency,
    public.admin_company_employees_count(c.id) AS employees_count,
    'subscription_base'::text AS plan_code,
    CASE WHEN cs.current_period_end >= now() THEN 'active' ELSE 'expired' END AS subscription_status,
    cs.current_period_end,
    0 AS grace_period_days,
    COALESCE((SELECT SUM(quantity)::int FROM addon_rows WHERE code = 'extra_seat'), 0) AS extra_seats,
    0 AS extra_storage_gb,
    c.updated_at
  FROM public.companies c
  LEFT JOIN public.company_subscriptions cs ON cs.company_id = c.id
  WHERE c.id = p_company_id
  LIMIT 1;
END;
$$;

-- Super-admin subscription meta with effective status.
CREATE OR REPLACE FUNCTION public.admin_get_company_subscription_meta(p_company_id uuid)
RETURNS TABLE(
  company_id uuid,
  plan_code text,
  subscription_status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_period_days int,
  cancel_at_period_end boolean,
  source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_assert_super_admin();
  PERFORM public.ensure_company_subscription(p_company_id);

  RETURN QUERY
  SELECT
    cs.company_id,
    'subscription_base'::text AS plan_code,
    CASE WHEN cs.current_period_end >= now() THEN 'active' ELSE 'expired' END AS subscription_status,
    cs.current_period_start,
    cs.current_period_end,
    0 AS grace_period_days,
    COALESCE(cs.cancel_at_period_end, false) AS cancel_at_period_end,
    cs.source
  FROM public.company_subscriptions cs
  WHERE cs.company_id = p_company_id
  LIMIT 1;
END;
$$;

-- Super-admin manual controls: period end + extra seats (+ optional cancel_at_period_end).
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

  v_period_end := COALESCE(p_period_end, v_existing.current_period_end, now() + interval '30 days');
  v_status := COALESCE(
    CASE WHEN p_status IN ('active', 'expired') THEN p_status ELSE NULL END,
    CASE WHEN v_period_end >= now() THEN 'active' ELSE 'expired' END
  );
  v_cancel_at_period_end := COALESCE(p_cancel_at_period_end, v_existing.cancel_at_period_end, false);

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

  IF v_addon_extra_seat IS NOT NULL AND p_extra_seats IS NOT NULL THEN
    DELETE FROM public.company_subscription_addons
    WHERE subscription_id = v_sub.id
      AND addon_id = v_addon_extra_seat;

    IF p_extra_seats > 0 THEN
      INSERT INTO public.company_subscription_addons(subscription_id, addon_id, quantity)
      VALUES (v_sub.id, v_addon_extra_seat, p_extra_seats)
      ON CONFLICT (subscription_id, addon_id)
      DO UPDATE SET quantity = EXCLUDED.quantity;
    END IF;
  END IF;

  RETURN v_sub;
END;
$$;

-- Backward-compatible owner helper for manual/testing updates.
CREATE OR REPLACE FUNCTION public.admin_set_subscription(
  p_company_id uuid,
  p_plan_code text,
  p_period_end timestamptz,
  p_status text,
  p_addons_json jsonb DEFAULT '[]'::jsonb
)
RETURNS public.company_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.company_subscriptions%ROWTYPE;
BEGIN
  IF NOT public.is_company_owner(p_company_id) THEN
    RAISE EXCEPTION 'only owner can set subscription for company %', p_company_id USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('active', 'expired') THEN
    RAISE EXCEPTION 'unsupported status: %', p_status;
  END IF;

  v_sub := public.admin_set_company_subscription_super(
    p_company_id => p_company_id,
    p_plan_code => NULL,
    p_status => p_status,
    p_period_end => p_period_end,
    p_extra_seats => NULL,
    p_cancel_at_period_end => false
  );

  RETURN v_sub;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_company_subscription(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_company_subscription_meta(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_company_subscription_super(uuid, text, text, timestamptz, int, int, int, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_subscription(uuid, text, timestamptz, text, jsonb) TO authenticated;

COMMIT;
