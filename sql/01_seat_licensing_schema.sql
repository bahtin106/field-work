-- sql/01_seat_licensing_schema.sql
-- Seat-based licensing model: owner + additional users, server-enforced.

BEGIN;

-- 1) Extend subscription with explicit paid seats model.
DO $$
BEGIN
  IF to_regclass('public.company_subscriptions') IS NULL THEN
    RAISE EXCEPTION 'public.company_subscriptions is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='company_subscriptions' AND column_name='included_owner_seat'
  ) THEN
    ALTER TABLE public.company_subscriptions
      ADD COLUMN included_owner_seat boolean NOT NULL DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='company_subscriptions' AND column_name='paid_seats_total'
  ) THEN
    ALTER TABLE public.company_subscriptions
      ADD COLUMN paid_seats_total int NOT NULL DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='company_subscriptions' AND column_name='paid_seats_additional'
  ) THEN
    ALTER TABLE public.company_subscriptions
      ADD COLUMN paid_seats_additional int NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='company_subscriptions' AND column_name='pending_paid_seats_total'
  ) THEN
    ALTER TABLE public.company_subscriptions
      ADD COLUMN pending_paid_seats_total int;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='company_subscriptions' AND column_name='pending_apply_at'
  ) THEN
    ALTER TABLE public.company_subscriptions
      ADD COLUMN pending_apply_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.company_subscriptions'::regclass AND conname='company_subscriptions_paid_seats_total_check'
  ) THEN
    ALTER TABLE public.company_subscriptions
      ADD CONSTRAINT company_subscriptions_paid_seats_total_check
      CHECK (paid_seats_total >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.company_subscriptions'::regclass AND conname='company_subscriptions_paid_seats_additional_check'
  ) THEN
    ALTER TABLE public.company_subscriptions
      ADD CONSTRAINT company_subscriptions_paid_seats_additional_check
      CHECK (paid_seats_additional >= 0);
  END IF;
END;
$$;

-- initialize paid_seats_total from existing addon model (owner + extra seats)
WITH extra AS (
  SELECT
    cs.id AS subscription_id,
    COALESCE(SUM(csa.quantity), 0)::int AS extra_seats
  FROM public.company_subscriptions cs
  LEFT JOIN public.company_subscription_addons csa ON csa.subscription_id = cs.id
  LEFT JOIN public.billing_addons ba ON ba.id = csa.addon_id
  WHERE ba.code = 'extra_seat' OR ba.code IS NULL
  GROUP BY cs.id
)
UPDATE public.company_subscriptions cs
SET
  paid_seats_total = GREATEST(1, 1 + COALESCE(e.extra_seats, 0)),
  paid_seats_additional = GREATEST(0, COALESCE(e.extra_seats, 0))
FROM extra e
WHERE e.subscription_id = cs.id;

-- 2) Extend profiles with independent admin/licensing block states.
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'public.profiles is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='is_admin_blocked'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN is_admin_blocked boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='license_state'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN license_state text NOT NULL DEFAULT 'active';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='blocked_reason'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN blocked_reason text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.profiles'::regclass AND conname='profiles_license_state_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_license_state_check
      CHECK (license_state IN ('active', 'blocked_by_license'));
  END IF;
END;
$$;

UPDATE public.profiles
SET is_admin_blocked = COALESCE(is_suspended, false)
WHERE is_admin_blocked IS DISTINCT FROM COALESCE(is_suspended, false);

-- 3) Seat assignments pool.
CREATE TABLE IF NOT EXISTS public.company_seat_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  reason text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_seat_assignments_company_user_fk
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.company_seat_assignments'::regclass
      AND conname = 'company_seat_assignments_company_fk'
  ) THEN
    ALTER TABLE public.company_seat_assignments
      ADD CONSTRAINT company_seat_assignments_company_fk
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_company_seat_assignments_company_active
  ON public.company_seat_assignments (company_id, revoked_at, assigned_at);
CREATE INDEX IF NOT EXISTS idx_company_seat_assignments_user_active
  ON public.company_seat_assignments (user_id, revoked_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_seat_assignments_active_company_user
  ON public.company_seat_assignments (company_id, user_id)
  WHERE revoked_at IS NULL;

-- 4) Security: table visible, writes only via SECURITY DEFINER functions.
ALTER TABLE public.company_seat_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_seat_assignments_select_owner ON public.company_seat_assignments;
CREATE POLICY company_seat_assignments_select_owner
ON public.company_seat_assignments
FOR SELECT
TO authenticated
USING (
  public.is_super_admin()
  OR public.is_company_owner(company_id)
);

DROP POLICY IF EXISTS company_seat_assignments_no_direct_write ON public.company_seat_assignments;
CREATE POLICY company_seat_assignments_no_direct_write
ON public.company_seat_assignments
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

REVOKE ALL ON TABLE public.company_seat_assignments FROM anon;
REVOKE ALL ON TABLE public.company_seat_assignments FROM authenticated;
GRANT SELECT ON TABLE public.company_seat_assignments TO authenticated;

-- 5) Permission helpers.
CREATE OR REPLACE FUNCTION public.is_company_license_admin(p_company_id uuid)
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
  IF p_company_id IS NULL OR v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_super_admin() OR public.is_company_owner(p_company_id) THEN
    RETURN true;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = v_uid
        AND p.company_id = p_company_id
        AND lower(coalesce(p.role, '')) = 'admin'
    ) INTO v_ok;
  END IF;

  RETURN COALESCE(v_ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.company_paid_seats_total(p_company_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN 1;
  END IF;

  SELECT cs.paid_seats_total
  INTO v_total
  FROM public.company_subscriptions cs
  WHERE cs.company_id = p_company_id
  LIMIT 1;

  IF v_total IS NULL THEN
    BEGIN
      RETURN public.company_allowed_seats(p_company_id);
    EXCEPTION WHEN others THEN
      RETURN 1;
    END;
  END IF;

  RETURN GREATEST(1, v_total);
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

  IF to_regclass('public.company_seat_assignments') IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::int
  INTO v_count
  FROM public.company_seat_assignments s
  WHERE s.company_id = p_company_id
    AND s.revoked_at IS NULL;

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.user_has_active_seat(p_company_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_company_id IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.company_seat_assignments s
    WHERE s.company_id = p_company_id
      AND s.user_id = p_user_id
      AND s.revoked_at IS NULL
  );
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
  v_allowed := public.company_paid_seats_total(p_company_id);

  RETURN v_used < v_allowed;
END;
$$;

-- 6) Sync helper for profile license state.
CREATE OR REPLACE FUNCTION public.sync_member_license_state(p_company_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_seat boolean;
BEGIN
  IF p_company_id IS NULL OR p_user_id IS NULL THEN
    RETURN;
  END IF;

  v_has_seat := public.user_has_active_seat(p_company_id, p_user_id);

  UPDATE public.profiles p
  SET
    license_state = CASE WHEN v_has_seat THEN 'active' ELSE 'blocked_by_license' END,
    blocked_reason = CASE WHEN v_has_seat THEN NULL ELSE COALESCE(p.blocked_reason, 'no_paid_seat') END
  WHERE p.id = p_user_id
    AND p.company_id = p_company_id;
END;
$$;

-- 7) Seat operations.
CREATE OR REPLACE FUNCTION public.assign_seat(p_company_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used int;
  v_paid int;
BEGIN
  IF p_company_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'company_id and user_id are required';
  END IF;

  IF NOT public.is_company_license_admin(p_company_id) THEN
    RAISE EXCEPTION 'license admin access required for company %', p_company_id USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id AND p.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'user % is not in company %', p_user_id, p_company_id;
  END IF;

  IF public.user_has_active_seat(p_company_id, p_user_id) THEN
    PERFORM public.sync_member_license_state(p_company_id, p_user_id);
    RETURN jsonb_build_object('ok', true, 'already_assigned', true, 'company_id', p_company_id, 'user_id', p_user_id);
  END IF;

  v_used := public.company_used_seats(p_company_id);
  v_paid := public.company_paid_seats_total(p_company_id);

  IF v_used >= v_paid THEN
    RAISE EXCEPTION 'seat limit exceeded: used %, paid %', v_used, v_paid USING ERRCODE='42501';
  END IF;

  INSERT INTO public.company_seat_assignments (company_id, user_id, reason)
  VALUES (p_company_id, p_user_id, 'manual')
  ON CONFLICT DO NOTHING;

  UPDATE public.profiles
  SET
    license_state = 'active',
    blocked_reason = NULL
  WHERE id = p_user_id
    AND company_id = p_company_id;

  RETURN jsonb_build_object('ok', true, 'company_id', p_company_id, 'user_id', p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_seat(p_company_id uuid, p_user_id uuid, p_reason text DEFAULT 'manual')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := COALESCE(NULLIF(trim(p_reason), ''), 'manual');
BEGIN
  IF p_company_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'company_id and user_id are required';
  END IF;

  IF NOT public.is_company_license_admin(p_company_id) THEN
    RAISE EXCEPTION 'license admin access required for company %', p_company_id USING ERRCODE='42501';
  END IF;

  UPDATE public.company_seat_assignments
  SET revoked_at = now(), reason = v_reason
  WHERE company_id = p_company_id
    AND user_id = p_user_id
    AND revoked_at IS NULL;

  UPDATE public.profiles
  SET
    license_state = 'blocked_by_license',
    blocked_reason = v_reason
  WHERE id = p_user_id
    AND company_id = p_company_id;

  RETURN jsonb_build_object('ok', true, 'company_id', p_company_id, 'user_id', p_user_id, 'reason', v_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_seat(p_company_id uuid, p_from_user_id uuid, p_to_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_from_user_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION 'from_user_id and to_user_id are required';
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'from_user_id and to_user_id must be different';
  END IF;

  PERFORM public.revoke_seat(p_company_id, p_from_user_id, 'replace');
  PERFORM public.assign_seat(p_company_id, p_to_user_id);

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'from_user_id', p_from_user_id,
    'to_user_id', p_to_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_seat_limit(p_company_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used int;
  v_paid int;
  v_to_revoke int;
  v_user_id uuid;
  v_revoked int := 0;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN 0;
  END IF;

  v_used := public.company_used_seats(p_company_id);
  v_paid := public.company_paid_seats_total(p_company_id);

  IF v_used <= v_paid THEN
    RETURN 0;
  END IF;

  v_to_revoke := v_used - v_paid;

  FOR v_user_id IN
    SELECT s.user_id
    FROM public.company_seat_assignments s
    WHERE s.company_id = p_company_id
      AND s.revoked_at IS NULL
    ORDER BY s.assigned_at DESC, s.id DESC
    LIMIT v_to_revoke
  LOOP
    PERFORM public.revoke_seat(p_company_id, v_user_id, 'auto_downgrade');
    v_revoked := v_revoked + 1;
  END LOOP;

  RETURN v_revoked;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_enforce_seat_limit(p_company_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_assert_super_admin();
  RETURN public.enforce_seat_limit(p_company_id);
END;
$$;

-- 8) Next period seat changes (no proration): optional scheduler/manual call.
CREATE OR REPLACE FUNCTION public.set_paid_seats_total(
  p_company_id uuid,
  p_paid_seats_total int,
  p_apply_next_period boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.company_subscriptions%ROWTYPE;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required';
  END IF;

  IF p_paid_seats_total IS NULL OR p_paid_seats_total < 1 THEN
    RAISE EXCEPTION 'paid_seats_total must be >= 1';
  END IF;

  IF NOT public.is_company_license_admin(p_company_id) THEN
    RAISE EXCEPTION 'license admin access required for company %', p_company_id USING ERRCODE='42501';
  END IF;

  v_sub := public.ensure_company_subscription(p_company_id);

  IF COALESCE(p_apply_next_period, true) AND p_paid_seats_total < v_sub.paid_seats_total THEN
    UPDATE public.company_subscriptions
    SET
      pending_paid_seats_total = p_paid_seats_total,
      pending_apply_at = v_sub.current_period_end,
      updated_at = now()
    WHERE company_id = p_company_id;

    RETURN jsonb_build_object(
      'ok', true,
      'scheduled', true,
      'apply_at', v_sub.current_period_end,
      'current_paid_seats_total', v_sub.paid_seats_total,
      'pending_paid_seats_total', p_paid_seats_total
    );
  END IF;

  UPDATE public.company_subscriptions
  SET
    paid_seats_total = p_paid_seats_total,
    paid_seats_additional = GREATEST(0, p_paid_seats_total - 1),
    pending_paid_seats_total = NULL,
    pending_apply_at = NULL,
    updated_at = now()
  WHERE company_id = p_company_id;

  PERFORM public.enforce_seat_limit(p_company_id);

  RETURN jsonb_build_object(
    'ok', true,
    'scheduled', false,
    'paid_seats_total', p_paid_seats_total
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_pending_seat_change_if_due(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.company_subscriptions%ROWTYPE;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_sub
  FROM public.company_subscriptions
  WHERE company_id = p_company_id
  LIMIT 1;

  IF v_sub.id IS NULL THEN
    RETURN false;
  END IF;

  IF v_sub.pending_paid_seats_total IS NULL OR v_sub.pending_apply_at IS NULL OR now() < v_sub.pending_apply_at THEN
    RETURN false;
  END IF;

  UPDATE public.company_subscriptions
  SET
    paid_seats_total = GREATEST(1, v_sub.pending_paid_seats_total),
    paid_seats_additional = GREATEST(0, GREATEST(1, v_sub.pending_paid_seats_total) - 1),
    pending_paid_seats_total = NULL,
    pending_apply_at = NULL,
    updated_at = now()
  WHERE company_id = p_company_id;

  PERFORM public.enforce_seat_limit(p_company_id);
  RETURN true;
END;
$$;

-- 9) Access state RPCs.
CREATE OR REPLACE FUNCTION public.get_company_access_state(p_company_id uuid)
RETURNS TABLE(
  company_id uuid,
  paid_seats_total int,
  used_seats int,
  free_seats int,
  subscription_status text,
  period_end timestamptz,
  needs_seat_release boolean,
  required_release_count int,
  member_id uuid,
  member_name text,
  member_role text,
  admin_blocked boolean,
  license_state text,
  has_seat boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.company_subscriptions%ROWTYPE;
  v_paid int;
  v_used int;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required';
  END IF;

  IF NOT public.is_company_member(p_company_id)
     AND NOT public.is_company_owner(p_company_id)
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'access denied to company %', p_company_id USING ERRCODE='42501';
  END IF;

  v_sub := public.ensure_company_subscription(p_company_id);
  PERFORM public.apply_pending_seat_change_if_due(p_company_id);

  SELECT * INTO v_sub FROM public.company_subscriptions WHERE company_id = p_company_id LIMIT 1;

  v_paid := public.company_paid_seats_total(p_company_id);
  v_used := public.company_used_seats(p_company_id);

  RETURN QUERY
  SELECT
    p_company_id,
    v_paid,
    v_used,
    GREATEST(0, v_paid - v_used),
    CASE WHEN v_sub.current_period_end >= now() THEN 'active' ELSE 'expired' END,
    v_sub.current_period_end,
    (v_used > v_paid),
    GREATEST(0, v_used - v_paid),
    p.id,
    COALESCE(NULLIF(p.full_name, ''), trim(concat_ws(' ', p.first_name, p.last_name)), p.email, p.id::text),
    p.role,
    (COALESCE(p.is_admin_blocked, false) OR COALESCE(p.is_suspended, false)) AS admin_blocked,
    COALESCE(p.license_state, 'active') AS license_state,
    public.user_has_active_seat(p_company_id, p.id) AS has_seat
  FROM public.profiles p
  WHERE p.company_id = p_company_id
  ORDER BY member_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_access_state()
RETURNS TABLE(
  user_id uuid,
  company_id uuid,
  admin_blocked boolean,
  license_state text,
  has_seat boolean,
  can_login boolean,
  block_code text,
  block_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_has_seat boolean := false;
  v_admin_blocked boolean := false;
  v_license_state text := 'active';
  v_can_login boolean := true;
  v_block_code text := NULL;
  v_block_message text := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_uid
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RETURN QUERY SELECT v_uid, NULL::uuid, false, 'active'::text, false, false, 'profile_missing'::text, 'Профиль не найден'::text;
    RETURN;
  END IF;

  IF v_profile.company_id IS NOT NULL THEN
    PERFORM public.apply_pending_seat_change_if_due(v_profile.company_id);
    v_has_seat := public.user_has_active_seat(v_profile.company_id, v_uid);
  END IF;

  v_admin_blocked := COALESCE(v_profile.is_admin_blocked, false) OR COALESCE(v_profile.is_suspended, false);
  v_license_state := COALESCE(v_profile.license_state, CASE WHEN v_has_seat THEN 'active' ELSE 'blocked_by_license' END);

  IF v_admin_blocked THEN
    v_can_login := false;
    v_block_code := 'admin_blocked';
    v_block_message := 'Доступ заблокирован, обратитесь к администратору';
  ELSIF v_license_state = 'blocked_by_license' OR NOT v_has_seat THEN
    v_can_login := false;
    v_block_code := 'blocked_by_license';
    v_block_message := 'Нет оплаченного места. Обратитесь к администратору компании';
  ELSE
    v_can_login := true;
  END IF;

  RETURN QUERY
  SELECT
    v_uid,
    v_profile.company_id,
    v_admin_blocked,
    v_license_state,
    v_has_seat,
    v_can_login,
    v_block_code,
    v_block_message;
END;
$$;

-- 10) Triggers for automatic assignment / license blocking.
CREATE OR REPLACE FUNCTION public.trg_profiles_license_before()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- keep compatibility with legacy field
  IF TG_OP = 'UPDATE' AND NEW.is_suspended IS DISTINCT FROM OLD.is_suspended THEN
    NEW.is_admin_blocked := COALESCE(NEW.is_suspended, false);
  END IF;

  -- Unblock guard: cannot unblock admin-block if no seat available and member is license-blocked.
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.is_admin_blocked, false) = true
     AND COALESCE(NEW.is_admin_blocked, false) = false
     AND COALESCE(OLD.license_state, 'active') = 'blocked_by_license'
     AND NOT public.user_has_active_seat(NEW.company_id, NEW.id)
     AND NOT public.can_company_add_member(NEW.company_id)
  THEN
    RAISE EXCEPTION 'no free paid seats to unblock member' USING ERRCODE='42501';
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.license_state, 'active') = 'blocked_by_license'
     AND COALESCE(NEW.license_state, 'active') = 'active'
     AND NOT public.user_has_active_seat(NEW.company_id, NEW.id)
     AND NOT public.can_company_add_member(NEW.company_id)
  THEN
    RAISE EXCEPTION 'no free paid seats to activate member' USING ERRCODE='42501';
  END IF;

  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id) THEN
    IF public.can_company_add_member(NEW.company_id) THEN
      NEW.license_state := 'active';
      NEW.blocked_reason := NULL;
    ELSE
      NEW.license_state := 'blocked_by_license';
      NEW.blocked_reason := 'no_paid_seat';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_profiles_license_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- if moved between companies, revoke old seat.
  IF TG_OP = 'UPDATE' AND OLD.company_id IS DISTINCT FROM NEW.company_id AND OLD.company_id IS NOT NULL THEN
    UPDATE public.company_seat_assignments
    SET revoked_at = now(), reason = 'moved_company'
    WHERE company_id = OLD.company_id
      AND user_id = NEW.id
      AND revoked_at IS NULL;
  END IF;

  -- admin-blocked users must not hold paid seat.
  IF COALESCE(NEW.is_admin_blocked, false) OR COALESCE(NEW.is_suspended, false) THEN
    UPDATE public.company_seat_assignments
    SET revoked_at = now(), reason = 'admin_block'
    WHERE company_id = NEW.company_id
      AND user_id = NEW.id
      AND revoked_at IS NULL;

    UPDATE public.profiles
    SET license_state = COALESCE(license_state, 'blocked_by_license')
    WHERE id = NEW.id;

    RETURN NEW;
  END IF;

  IF COALESCE(NEW.license_state, 'active') = 'active' THEN
    IF NOT public.user_has_active_seat(NEW.company_id, NEW.id) THEN
      IF public.can_company_add_member(NEW.company_id) THEN
        INSERT INTO public.company_seat_assignments(company_id, user_id, reason)
        VALUES (NEW.company_id, NEW.id, 'manual')
        ON CONFLICT DO NOTHING;
      ELSE
        UPDATE public.profiles
        SET
          license_state = 'blocked_by_license',
          blocked_reason = 'no_paid_seat'
        WHERE id = NEW.id;
      END IF;
    END IF;
  ELSE
    UPDATE public.company_seat_assignments
    SET revoked_at = now(), reason = COALESCE(NEW.blocked_reason, 'license_block')
    WHERE company_id = NEW.company_id
      AND user_id = NEW.id
      AND revoked_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_enforce_seat_policy ON public.profiles;
DROP TRIGGER IF EXISTS trg_profiles_license_before ON public.profiles;
DROP TRIGGER IF EXISTS trg_profiles_license_after ON public.profiles;

CREATE TRIGGER trg_profiles_license_before
BEFORE INSERT OR UPDATE OF company_id, is_suspended, is_admin_blocked
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.trg_profiles_license_before();

CREATE TRIGGER trg_profiles_license_after
AFTER INSERT OR UPDATE OF company_id, is_suspended, is_admin_blocked, license_state
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.trg_profiles_license_after();

-- 11) Auto-enforce on paid seats change.
CREATE OR REPLACE FUNCTION public.trg_company_subscriptions_enforce_seats_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.paid_seats_total IS DISTINCT FROM OLD.paid_seats_total THEN
    PERFORM public.enforce_seat_limit(NEW.company_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_subscriptions_enforce_seats_after_update ON public.company_subscriptions;
CREATE TRIGGER trg_company_subscriptions_enforce_seats_after_update
AFTER UPDATE OF paid_seats_total
ON public.company_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.trg_company_subscriptions_enforce_seats_after_update();

-- 12) Keep entitlements compatible but based on seat-pool totals.
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
  v_allowed int;
  v_used int;
BEGIN
  v_is_member := public.is_company_member(p_company_id);
  v_is_owner := public.is_company_owner(p_company_id);

  IF NOT v_is_member AND NOT v_is_owner THEN
    RAISE EXCEPTION 'access denied to company %', p_company_id USING ERRCODE = '42501';
  END IF;

  PERFORM public.apply_pending_seat_change_if_due(p_company_id);
  v_sub := public.ensure_company_subscription(p_company_id);
  v_policy := public.company_seat_overlimit_policy(p_company_id);
  v_allowed := public.company_paid_seats_total(p_company_id);
  v_used := public.company_used_seats(p_company_id);

  RETURN QUERY
  SELECT
    p_company_id,
    v_is_owner,
    CASE WHEN v_is_owner THEN 'subscription_base' ELSE NULL END,
    CASE WHEN v_is_owner THEN 'Subscription' ELSE NULL END,
    CASE WHEN v_sub.current_period_end >= now() THEN 'active' ELSE 'expired' END,
    v_sub.current_period_end,
    0,
    public.billing_can_edit_company(p_company_id),
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_sub.current_period_end - now())) / 86400.0))::int,
    CASE WHEN v_is_owner THEN v_allowed ELSE NULL END,
    v_used,
    NULL::int,
    0::numeric,
    jsonb_build_object(
      'seat_policy', v_policy,
      'is_over_limit', (v_used > v_allowed),
      'over_limit_by', GREATEST(0, v_used - v_allowed),
      'can_add_members', public.can_company_add_member(p_company_id),
      'paid_seats_total', v_allowed,
      'used_seats', v_used,
      'free_seats', (v_allowed - v_used)
    ),
    '{}'::jsonb;
END;
$$;

-- 13) Seed current seat assignments for existing active members if empty.
WITH companies_with_profiles AS (
  SELECT DISTINCT p.company_id
  FROM public.profiles p
  WHERE p.company_id IS NOT NULL
),
seedable AS (
  SELECT c.company_id
  FROM companies_with_profiles c
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.company_seat_assignments s
    WHERE s.company_id = c.company_id
      AND s.revoked_at IS NULL
  )
),
ranked_profiles AS (
  SELECT
    p.company_id,
    p.id AS user_id,
    ROW_NUMBER() OVER (PARTITION BY p.company_id ORDER BY p.created_at, p.id) AS rn
  FROM public.profiles p
  JOIN seedable s ON s.company_id = p.company_id
  WHERE COALESCE(p.is_admin_blocked, false) = false
    AND COALESCE(p.is_suspended, false) = false
)
INSERT INTO public.company_seat_assignments(company_id, user_id, reason)
SELECT
  rp.company_id,
  rp.user_id,
  'bootstrap'
FROM ranked_profiles rp
WHERE rp.rn <= public.company_paid_seats_total(rp.company_id)
ON CONFLICT DO NOTHING;

-- sync license_state after bootstrap
UPDATE public.profiles p
SET
  license_state = CASE
    WHEN public.user_has_active_seat(p.company_id, p.id) THEN 'active'
    ELSE 'blocked_by_license'
  END,
  blocked_reason = CASE
    WHEN public.user_has_active_seat(p.company_id, p.id) THEN NULL
    ELSE COALESCE(p.blocked_reason, 'no_paid_seat')
  END
WHERE p.company_id IS NOT NULL;

-- 14) Grants
GRANT EXECUTE ON FUNCTION public.is_company_license_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_paid_seats_total(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_used_seats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_active_seat(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_member_license_state(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_seat(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_seat(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_seat(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_paid_seats_total(uuid, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pending_seat_change_if_due(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_access_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_access_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enforce_seat_limit(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_seat_limit(uuid) FROM authenticated;

COMMIT;
