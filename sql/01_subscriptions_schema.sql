-- sql/01_subscriptions_schema.sql
-- Subscription foundation schema for Supabase/Postgres with RLS and extensible entitlements.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Helper: generic company membership check (supports current and fallback schemas)
CREATE OR REPLACE FUNCTION public.is_company_member(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ok boolean := false;
BEGIN
  IF v_uid IS NULL OR p_company_id IS NULL THEN
    RETURN false;
  END IF;

  -- Fast path for projects that already expose current company via helper
  IF to_regprocedure('public.user_company_id()') IS NOT NULL THEN
    BEGIN
      IF public.user_company_id() = p_company_id THEN
        RETURN true;
      END IF;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  IF to_regclass('public.company_members') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT EXISTS (
          SELECT 1
          FROM public.company_members cm
          WHERE cm.company_id = $1
            AND (cm.user_id = $2 OR cm.profile_id = $2)
            AND (cm.is_active IS NULL OR cm.is_active = true)
        )
      $q$ INTO v_ok USING p_company_id, v_uid;
      IF v_ok THEN
        RETURN true;
      END IF;
    EXCEPTION WHEN others THEN
      -- Fallback below
      NULL;
    END;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE (p.id = $1 OR p.user_id = $1) AND p.company_id = $2
        )
      $q$ INTO v_ok USING v_uid, p_company_id;
      RETURN COALESCE(v_ok, false);
    EXCEPTION WHEN others THEN
      RETURN false;
    END;
  END IF;

  RETURN false;
END;
$$;

-- Helper: owner check (company_members role='owner' preferred; fallback to companies.owner_id; fallback profiles.role='admin')
CREATE OR REPLACE FUNCTION public.is_company_owner(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ok boolean := false;
BEGIN
  IF v_uid IS NULL OR p_company_id IS NULL THEN
    RETURN false;
  END IF;

  -- Fast path for projects with helper predicates in existing RLS
  IF to_regprocedure('public.user_company_id()') IS NOT NULL
     AND to_regprocedure('public.is_admin()') IS NOT NULL THEN
    BEGIN
      IF public.is_admin() AND public.user_company_id() = p_company_id THEN
        RETURN true;
      END IF;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  IF to_regclass('public.company_members') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT EXISTS (
          SELECT 1
          FROM public.company_members cm
          WHERE cm.company_id = $1
            AND (cm.user_id = $2 OR cm.profile_id = $2)
            AND lower(coalesce(cm.role, '')) = 'owner'
            AND (cm.is_active IS NULL OR cm.is_active = true)
        )
      $q$ INTO v_ok USING p_company_id, v_uid;
      IF v_ok THEN
        RETURN true;
      END IF;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  IF to_regclass('public.companies') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT EXISTS (
          SELECT 1
          FROM public.companies c
          WHERE c.id = $1 AND c.owner_id = $2
        )
      $q$ INTO v_ok USING p_company_id, v_uid;
      IF v_ok THEN
        RETURN true;
      END IF;
    EXCEPTION WHEN undefined_column THEN
      NULL;
    WHEN others THEN
      NULL;
    END;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE (p.id = $1 OR p.user_id = $1)
            AND p.company_id = $2
            AND lower(coalesce(p.role, '')) = 'admin'
        )
      $q$ INTO v_ok USING v_uid, p_company_id;
      IF v_ok THEN
        RETURN true;
      END IF;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  RETURN false;
END;
$$;

-- Helper: whether modifications are allowed for company (server-side read-only switch)
CREATE OR REPLACE FUNCTION public.billing_can_edit_company(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_end timestamptz;
  v_grace int;
BEGIN
  IF NOT public.is_company_member(p_company_id) THEN
    RETURN false;
  END IF;

  IF to_regclass('public.company_subscriptions') IS NULL THEN
    RETURN true;
  END IF;

  EXECUTE $q$
    SELECT status, current_period_end, COALESCE(grace_period_days, 0)
    FROM public.company_subscriptions
    WHERE company_id = $1
    LIMIT 1
  $q$ INTO v_status, v_end, v_grace USING p_company_id;

  IF v_status IS NULL THEN
    RETURN true;
  END IF;

  IF v_status IN ('active', 'trial') THEN
    RETURN true;
  END IF;

  IF v_status = 'past_due' AND now() <= (v_end + make_interval(days => COALESCE(v_grace, 0))) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE TABLE IF NOT EXISTS public.billing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  base_price_month numeric(12,2),
  included_seats int NOT NULL DEFAULT 1,
  included_storage_gb int NOT NULL DEFAULT 0,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  unit text NOT NULL CHECK (unit IN ('seat', 'gb', 'flag')),
  price_month numeric(12,2),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE,
  plan_id uuid NOT NULL REFERENCES public.billing_plans(id),
  status text NOT NULL CHECK (status IN ('trial', 'active', 'past_due', 'canceled', 'paused')),
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  grace_period_days int NOT NULL DEFAULT 7,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'yookassa', 'admin')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_subscription_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.company_subscriptions(id) ON DELETE CASCADE,
  addon_id uuid NOT NULL REFERENCES public.billing_addons(id),
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id, addon_id)
);

CREATE TABLE IF NOT EXISTS public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_company_subscriptions_company_id ON public.company_subscriptions(company_id);
CREATE INDEX IF NOT EXISTS idx_company_subscriptions_status ON public.company_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_company_subscription_addons_subscription_id ON public.company_subscription_addons(subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_company_id ON public.billing_events(company_id);

CREATE OR REPLACE FUNCTION public.touch_company_subscriptions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_subscriptions_updated_at ON public.company_subscriptions;
CREATE TRIGGER trg_company_subscriptions_updated_at
BEFORE UPDATE ON public.company_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.touch_company_subscriptions_updated_at();

-- Entitlements RPC
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
BEGIN
  v_is_member := public.is_company_member(p_company_id);
  v_is_owner := public.is_company_owner(p_company_id);

  IF NOT v_is_member AND NOT v_is_owner THEN
    RAISE EXCEPTION 'access denied to company %', p_company_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH sub AS (
    SELECT cs.*,
           bp.code AS plan_code,
           bp.name AS plan_name,
           bp.included_seats,
           bp.included_storage_gb,
           bp.features AS plan_features
    FROM public.company_subscriptions cs
    JOIN public.billing_plans bp ON bp.id = cs.plan_id
    WHERE cs.company_id = p_company_id
    LIMIT 1
  ),
  used AS (
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
    SELECT
      ba.code,
      ba.unit,
      csa.quantity,
      ba.config
    FROM public.company_subscription_addons csa
    JOIN public.billing_addons ba ON ba.id = csa.addon_id
    JOIN sub s ON s.id = csa.subscription_id
  ),
  addon_agg AS (
    SELECT
      COALESCE(SUM(CASE WHEN code = 'extra_seat' THEN quantity ELSE 0 END), 0)::int AS extra_seats,
      COALESCE(SUM(CASE WHEN code = 'extra_storage_gb' THEN quantity ELSE 0 END), 0)::int AS extra_storage_gb,
      COALESCE(
        jsonb_object_agg(code, jsonb_build_object('unit', unit, 'quantity', quantity, 'config', config))
          FILTER (WHERE code IS NOT NULL),
        '{}'::jsonb
      ) AS addons_json
    FROM addon_rows
  ),
  feature_flags AS (
    SELECT COALESCE(
      (SELECT jsonb_object_agg(code, to_jsonb(true)) FROM addon_rows WHERE unit = 'flag'),
      '{}'::jsonb
    ) AS addon_flag_features
  )
  SELECT
    p_company_id AS company_id,
    v_is_owner AS is_owner,
    CASE WHEN v_is_owner THEN s.plan_code ELSE NULL END AS plan_code,
    CASE WHEN v_is_owner THEN s.plan_name ELSE NULL END AS plan_name,
    COALESCE(s.status, 'inactive') AS status,
    s.current_period_end,
    COALESCE(s.grace_period_days, 0) AS grace_period_days,
    CASE
      WHEN s.status IN ('active', 'trial') THEN true
      WHEN s.status = 'past_due' AND now() <= s.current_period_end + make_interval(days => COALESCE(s.grace_period_days, 0)) THEN true
      ELSE false
    END AS can_edit,
    CASE
      WHEN s.current_period_end IS NULL THEN 0
      ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM (s.current_period_end - now())) / 86400.0))::int
    END AS days_left,
    CASE WHEN v_is_owner THEN (COALESCE(s.included_seats, 0) + COALESCE(a.extra_seats, 0))::int ELSE NULL END AS allowed_seats,
    u.used_seats,
    CASE WHEN v_is_owner THEN (COALESCE(s.included_storage_gb, 0) + COALESCE(a.extra_storage_gb, 0))::int ELSE NULL END AS allowed_storage_gb,
    u.used_storage_gb,
    CASE WHEN v_is_owner THEN COALESCE(s.plan_features, '{}'::jsonb) || COALESCE(ff.addon_flag_features, '{}'::jsonb) ELSE '{}'::jsonb END AS features,
    CASE WHEN v_is_owner THEN a.addons_json ELSE '{}'::jsonb END AS addons
  FROM (SELECT 1 AS _seed) seed
  LEFT JOIN sub s ON true
  CROSS JOIN used u
  CROSS JOIN addon_agg a
  CROSS JOIN feature_flags ff;
END;
$$;

-- Owner controlled helper function for manual/testing updates
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
  v_plan_id uuid;
  v_sub public.company_subscriptions%ROWTYPE;
  v_item jsonb;
  v_addon_code text;
  v_qty int;
  v_addon_id uuid;
BEGIN
  IF NOT public.is_company_owner(p_company_id) THEN
    RAISE EXCEPTION 'only owner can set subscription for company %', p_company_id USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('trial', 'active', 'past_due', 'canceled', 'paused') THEN
    RAISE EXCEPTION 'unsupported status: %', p_status;
  END IF;

  SELECT id INTO v_plan_id
  FROM public.billing_plans
  WHERE code = p_plan_code
  LIMIT 1;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'plan code not found: %', p_plan_code;
  END IF;

  INSERT INTO public.company_subscriptions (
    company_id,
    plan_id,
    status,
    current_period_start,
    current_period_end,
    source
  ) VALUES (
    p_company_id,
    v_plan_id,
    p_status,
    now(),
    p_period_end,
    'manual'
  )
  ON CONFLICT (company_id)
  DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    status = EXCLUDED.status,
    current_period_start = EXCLUDED.current_period_start,
    current_period_end = EXCLUDED.current_period_end,
    source = 'manual',
    updated_at = now()
  RETURNING * INTO v_sub;

  DELETE FROM public.company_subscription_addons
  WHERE subscription_id = v_sub.id;

  IF jsonb_typeof(COALESCE(p_addons_json, '[]'::jsonb)) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_addons_json, '[]'::jsonb))
    LOOP
      v_addon_code := COALESCE(v_item->>'code', '');
      v_qty := COALESCE((v_item->>'quantity')::int, 1);
      IF v_qty <= 0 THEN
        CONTINUE;
      END IF;

      SELECT id INTO v_addon_id
      FROM public.billing_addons
      WHERE code = v_addon_code
      LIMIT 1;

      IF v_addon_id IS NOT NULL THEN
        INSERT INTO public.company_subscription_addons(subscription_id, addon_id, quantity)
        VALUES (v_sub.id, v_addon_id, v_qty)
        ON CONFLICT (subscription_id, addon_id)
        DO UPDATE SET quantity = EXCLUDED.quantity;
      END IF;
    END LOOP;
  END IF;

  RETURN v_sub;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_entitlements(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_subscription(uuid, text, timestamptz, text, jsonb) TO authenticated;

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_subscription_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

-- Plans/addons: authenticated read-only
DROP POLICY IF EXISTS billing_plans_select_authenticated ON public.billing_plans;
CREATE POLICY billing_plans_select_authenticated
ON public.billing_plans
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS billing_addons_select_authenticated ON public.billing_addons;
CREATE POLICY billing_addons_select_authenticated
ON public.billing_addons
FOR SELECT
TO authenticated
USING (true);

-- Subscriptions/addons: select only owner
DROP POLICY IF EXISTS company_subscriptions_select_owner ON public.company_subscriptions;
CREATE POLICY company_subscriptions_select_owner
ON public.company_subscriptions
FOR SELECT
TO authenticated
USING (public.is_company_owner(company_id));

DROP POLICY IF EXISTS company_subscription_addons_select_owner ON public.company_subscription_addons;
CREATE POLICY company_subscription_addons_select_owner
ON public.company_subscription_addons
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.company_subscriptions cs
    WHERE cs.id = company_subscription_addons.subscription_id
      AND public.is_company_owner(cs.company_id)
  )
);

-- Manual owner write access (current testing stage)
DROP POLICY IF EXISTS company_subscriptions_owner_write ON public.company_subscriptions;
CREATE POLICY company_subscriptions_owner_write
ON public.company_subscriptions
FOR ALL
TO authenticated
USING (public.is_company_owner(company_id))
WITH CHECK (public.is_company_owner(company_id));

DROP POLICY IF EXISTS company_subscription_addons_owner_write ON public.company_subscription_addons;
CREATE POLICY company_subscription_addons_owner_write
ON public.company_subscription_addons
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.company_subscriptions cs
    WHERE cs.id = company_subscription_addons.subscription_id
      AND public.is_company_owner(cs.company_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.company_subscriptions cs
    WHERE cs.id = company_subscription_addons.subscription_id
      AND public.is_company_owner(cs.company_id)
  )
);

-- Billing events: no authenticated direct access
DROP POLICY IF EXISTS billing_events_no_auth_access ON public.billing_events;
CREATE POLICY billing_events_no_auth_access
ON public.billing_events
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- Read-only enforcement example on orders (server-side, additive + restrictive)
DO $$
BEGIN
  IF to_regclass('public.orders') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS orders_block_insert_by_subscription ON public.orders';
    EXECUTE 'DROP POLICY IF EXISTS orders_block_update_by_subscription ON public.orders';
    EXECUTE 'DROP POLICY IF EXISTS orders_block_delete_by_subscription ON public.orders';
    EXECUTE '
      CREATE POLICY orders_block_insert_by_subscription
      ON public.orders
      AS RESTRICTIVE
      FOR INSERT
      TO authenticated
      WITH CHECK (public.billing_can_edit_company(user_company_id()))
    ';
    EXECUTE '
      CREATE POLICY orders_block_update_by_subscription
      ON public.orders
      AS RESTRICTIVE
      FOR UPDATE
      TO authenticated
      USING (public.billing_can_edit_company(company_id))
      WITH CHECK (public.billing_can_edit_company(company_id))
    ';
    EXECUTE '
      CREATE POLICY orders_block_delete_by_subscription
      ON public.orders
      AS RESTRICTIVE
      FOR DELETE
      TO authenticated
      USING (public.billing_can_edit_company(company_id))
    ';
  END IF;
END;
$$;

COMMIT;
