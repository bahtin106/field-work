-- sql/09_remove_seat_policy_scenarios.sql
-- Remove seat over-limit scenarios: keep a single policy (block_new_members).

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.company_subscriptions') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'seat_overlimit_policy'
  ) THEN
    UPDATE public.company_subscriptions
    SET seat_overlimit_policy = 'block_new_members'
    WHERE seat_overlimit_policy IS DISTINCT FROM 'block_new_members';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'overlimit_grace_days'
  ) THEN
    UPDATE public.company_subscriptions
    SET overlimit_grace_days = 0
    WHERE COALESCE(overlimit_grace_days, 0) <> 0;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.company_subscriptions'::regclass
      AND conname = 'company_subscriptions_seat_overlimit_policy_check'
  ) THEN
    ALTER TABLE public.company_subscriptions
      DROP CONSTRAINT company_subscriptions_seat_overlimit_policy_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'seat_overlimit_policy'
  ) THEN
    ALTER TABLE public.company_subscriptions
      ADD CONSTRAINT company_subscriptions_seat_overlimit_policy_check
      CHECK (seat_overlimit_policy = 'block_new_members');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.company_seat_overlimit_policy(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'block_new_members';
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
  v_used int;
  v_allowed int;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN false;
  END IF;

  v_used := public.company_used_seats(p_company_id);
  v_allowed := public.company_paid_seats_total(p_company_id);

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
  v_used int;
  v_allowed int;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required';
  END IF;

  IF COALESCE(auth.role(), '') = 'service_role' OR public.is_super_admin() THEN
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

  v_used := public.company_used_seats(p_company_id);
  v_allowed := public.company_paid_seats_total(p_company_id);

  IF v_used >= v_allowed THEN
    RAISE EXCEPTION 'seat limit exceeded: used %, allowed %', v_used, v_allowed USING ERRCODE = '42501';
  END IF;
END;
$$;

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

-- Backward compatibility for older clients: always returns fixed policy values.
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
BEGIN
  PERFORM public.admin_assert_super_admin();
  PERFORM public.ensure_company_subscription(p_company_id);

  v_allowed := public.company_paid_seats_total(p_company_id);
  v_used := public.company_used_seats(p_company_id);

  RETURN QUERY
  SELECT
    'block_new_members'::text,
    v_allowed,
    v_used,
    GREATEST(0, v_used - v_allowed),
    (v_used > v_allowed),
    (v_used < v_allowed);
END;
$$;

-- Backward compatibility: ignores incoming policy and keeps fixed policy.
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
  PERFORM public.ensure_company_subscription(p_company_id);

  UPDATE public.company_subscriptions
  SET
    seat_overlimit_policy = 'block_new_members',
    overlimit_grace_days = 0,
    updated_at = now()
  WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'seat_overlimit_policy', 'block_new_members',
    'overlimit_grace_days', 0,
    'note', 'Seat over-limit scenarios are disabled'
  );
END;
$$;

COMMIT;
