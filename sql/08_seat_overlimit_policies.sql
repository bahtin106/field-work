-- sql/08_seat_overlimit_policies.sql
-- Seat over-limit scenarios + enforcement for employee creation.

BEGIN;

-- Company-level policy for what happens when used seats exceed paid seats.
DO $$
BEGIN
  IF to_regclass('public.company_subscriptions') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'seat_overlimit_policy'
  ) THEN
    ALTER TABLE public.company_subscriptions
      ADD COLUMN seat_overlimit_policy text NOT NULL DEFAULT 'block_new_members';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'overlimit_grace_days'
  ) THEN
    ALTER TABLE public.company_subscriptions
      ADD COLUMN overlimit_grace_days int NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.company_subscriptions'::regclass
      AND conname = 'company_subscriptions_seat_overlimit_policy_check'
  ) THEN
    ALTER TABLE public.company_subscriptions
      ADD CONSTRAINT company_subscriptions_seat_overlimit_policy_check
      CHECK (seat_overlimit_policy IN ('block_new_members', 'allow_overlimit', 'lock_writes_when_overlimit'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.company_subscriptions'::regclass
      AND conname = 'company_subscriptions_overlimit_grace_days_check'
  ) THEN
    ALTER TABLE public.company_subscriptions
      ADD CONSTRAINT company_subscriptions_overlimit_grace_days_check
      CHECK (overlimit_grace_days >= 0);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.company_used_seats(p_company_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN 0;
  END IF;

  IF to_regclass('public.company_members') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT COUNT(*)::int
        FROM public.company_members cm
        WHERE cm.company_id = $1
          AND (cm.is_active IS NULL OR cm.is_active = true)
      $q$ INTO v_count USING p_company_id;
      RETURN COALESCE(v_count, 0);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT COUNT(*)::int
        FROM public.profiles p
        WHERE p.company_id = $1
      $q$ INTO v_count USING p_company_id;
      RETURN COALESCE(v_count, 0);
    EXCEPTION WHEN others THEN
      RETURN 0;
    END;
  END IF;

  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.company_allowed_seats(p_company_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.company_subscriptions%ROWTYPE;
  v_extra int := 0;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN 1;
  END IF;

  IF to_regclass('public.company_subscriptions') IS NULL THEN
    RETURN 1;
  END IF;

  BEGIN
    v_sub := public.ensure_company_subscription(p_company_id);
  EXCEPTION WHEN others THEN
    SELECT * INTO v_sub
    FROM public.company_subscriptions
    WHERE company_id = p_company_id
    LIMIT 1;
  END;

  IF v_sub.id IS NULL THEN
    RETURN 1;
  END IF;

  IF to_regclass('public.company_subscription_addons') IS NOT NULL
     AND to_regclass('public.billing_addons') IS NOT NULL THEN
    SELECT COALESCE(SUM(csa.quantity), 0)::int
    INTO v_extra
    FROM public.company_subscription_addons csa
    JOIN public.billing_addons ba ON ba.id = csa.addon_id
    WHERE csa.subscription_id = v_sub.id
      AND ba.code = 'extra_seat';
  END IF;

  RETURN 1 + COALESCE(v_extra, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.company_seat_overlimit_policy(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy text;
BEGIN
  IF p_company_id IS NULL OR to_regclass('public.company_subscriptions') IS NULL THEN
    RETURN 'block_new_members';
  END IF;

  BEGIN
    SELECT cs.seat_overlimit_policy
    INTO v_policy
    FROM public.company_subscriptions cs
    WHERE cs.company_id = p_company_id
    LIMIT 1;
  EXCEPTION WHEN undefined_column THEN
    RETURN 'block_new_members';
  WHEN others THEN
    RETURN 'block_new_members';
  END;

  RETURN COALESCE(v_policy, 'block_new_members');
END;
$$;

CREATE OR REPLACE FUNCTION public.can_company_add_member(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy text;
  v_used int;
  v_allowed int;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN false;
  END IF;

  v_policy := public.company_seat_overlimit_policy(p_company_id);

  IF v_policy = 'allow_overlimit' THEN
    RETURN true;
  END IF;

  v_used := public.company_used_seats(p_company_id);
  v_allowed := public.company_allowed_seats(p_company_id);

  RETURN v_used < v_allowed;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_company_can_add_member(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.company_subscriptions%ROWTYPE;
  v_policy text;
  v_used int;
  v_allowed int;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required';
  END IF;

  -- service role and super-admin paths are explicitly allowed
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN;
  END IF;

  IF public.is_super_admin() THEN
    RETURN;
  END IF;

  BEGIN
    v_sub := public.ensure_company_subscription(p_company_id);
  EXCEPTION WHEN others THEN
    SELECT * INTO v_sub
    FROM public.company_subscriptions
    WHERE company_id = p_company_id
    LIMIT 1;
  END;

  IF v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end < now() THEN
    RAISE EXCEPTION 'subscription expired: company is read-only' USING ERRCODE = '42501';
  END IF;

  v_policy := public.company_seat_overlimit_policy(p_company_id);

  IF v_policy = 'allow_overlimit' THEN
    RETURN;
  END IF;

  v_used := public.company_used_seats(p_company_id);
  v_allowed := public.company_allowed_seats(p_company_id);

  IF v_used >= v_allowed THEN
    RAISE EXCEPTION 'seat limit exceeded: used %, allowed %', v_used, v_allowed USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Enforce seat policy at DB layer for any profile insertion/move to company.
CREATE OR REPLACE FUNCTION public.trg_profiles_enforce_seat_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.assert_company_can_add_member(NEW.company_id);
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS trg_profiles_enforce_seat_policy ON public.profiles;

  CREATE TRIGGER trg_profiles_enforce_seat_policy
  BEFORE INSERT OR UPDATE OF company_id
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_profiles_enforce_seat_policy();
END;
$$;

-- Reflect seat policy in global write gate.
CREATE OR REPLACE FUNCTION public.billing_can_edit_company(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.company_subscriptions%ROWTYPE;
  v_policy text;
BEGIN
  IF NOT public.is_company_member(p_company_id) THEN
    RETURN false;
  END IF;

  v_sub := public.ensure_company_subscription(p_company_id);
  IF v_sub.current_period_end < now() THEN
    RETURN false;
  END IF;

  v_policy := public.company_seat_overlimit_policy(p_company_id);
  IF v_policy = 'lock_writes_when_overlimit'
     AND public.company_used_seats(p_company_id) > public.company_allowed_seats(p_company_id) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- Enrich entitlements with seat policy state (without changing return type).
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
    GREATEST(
      0,
      (
        (date_trunc('day', v_sub.current_period_end AT TIME ZONE 'UTC')::date)
        - ((now() AT TIME ZONE 'UTC')::date)
      )::int
    ) AS days_left,
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

CREATE OR REPLACE FUNCTION public.admin_get_company_seat_policy(p_company_id uuid)
RETURNS TABLE(
  seat_overlimit_policy text,
  allowed_seats int,
  used_seats int,
  over_limit_by int,
  is_over_limit boolean,
  can_add_members boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed int;
  v_used int;
  v_policy text;
BEGIN
  PERFORM public.admin_assert_super_admin();
  PERFORM public.ensure_company_subscription(p_company_id);

  v_allowed := public.company_allowed_seats(p_company_id);
  v_used := public.company_used_seats(p_company_id);
  v_policy := public.company_seat_overlimit_policy(p_company_id);

  RETURN QUERY
  SELECT
    v_policy,
    v_allowed,
    v_used,
    GREATEST(0, v_used - v_allowed) AS over_limit_by,
    (v_used > v_allowed) AS is_over_limit,
    public.can_company_add_member(p_company_id) AS can_add_members;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_company_seat_policy(
  p_company_id uuid,
  p_seat_overlimit_policy text,
  p_overlimit_grace_days int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_assert_super_admin();

  IF p_seat_overlimit_policy NOT IN ('block_new_members', 'allow_overlimit', 'lock_writes_when_overlimit') THEN
    RAISE EXCEPTION 'unsupported seat_overlimit_policy: %', p_seat_overlimit_policy;
  END IF;

  PERFORM public.ensure_company_subscription(p_company_id);

  UPDATE public.company_subscriptions
  SET
    seat_overlimit_policy = p_seat_overlimit_policy,
    overlimit_grace_days = GREATEST(0, COALESCE(p_overlimit_grace_days, 0)),
    updated_at = now()
  WHERE company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'company subscription not found: %', p_company_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'seat_overlimit_policy', p_seat_overlimit_policy,
    'overlimit_grace_days', GREATEST(0, COALESCE(p_overlimit_grace_days, 0))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.company_used_seats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_allowed_seats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_seat_overlimit_policy(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_company_add_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_company_can_add_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_company_seat_policy(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_company_seat_policy(uuid, text, int) TO authenticated;

COMMIT;
