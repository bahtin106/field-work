BEGIN;

-- 1) Canonical used seats: count only active seat assignments for users
-- that still belong to the same company.
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

  IF to_regclass('public.company_seat_assignments') IS NULL OR to_regclass('public.profiles') IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(DISTINCT s.user_id)::int
  INTO v_count
  FROM public.company_seat_assignments s
  JOIN public.profiles p ON p.id = s.user_id
  WHERE s.company_id = p_company_id
    AND s.revoked_at IS NULL
    AND p.company_id = p_company_id;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- 2) Repair helper: revoke invalid/duplicate active seats and re-sync license_state.
CREATE OR REPLACE FUNCTION public.repair_company_seat_pool(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_revoked_not_in_company int := 0;
  v_revoked_blocked int := 0;
  v_revoked_manual_blocked int := 0;
  v_revoked_duplicates int := 0;
  v_profiles_synced int := 0;
  v_subscription_active boolean := true;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required';
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT public.is_company_license_admin(p_company_id)
     AND NOT public.is_super_admin()
     AND NOT public.is_company_owner(p_company_id) THEN
    RAISE EXCEPTION 'license admin access required for company %', p_company_id USING ERRCODE='42501';
  END IF;

  -- Revoke active seats for users no longer in this company.
  WITH revoked AS (
    UPDATE public.company_seat_assignments s
    SET
      revoked_at = now(),
      reason = 'repair_not_in_company'
    FROM public.profiles p
    WHERE s.company_id = p_company_id
      AND s.revoked_at IS NULL
      AND p.id = s.user_id
      AND p.company_id IS DISTINCT FROM p_company_id
    RETURNING s.id
  )
  SELECT COUNT(*)::int INTO v_revoked_not_in_company FROM revoked;

  -- Revoke active seats for admin-blocked/suspended users (seat must not be consumed).
  WITH revoked AS (
    UPDATE public.company_seat_assignments s
    SET
      revoked_at = now(),
      reason = 'repair_admin_blocked'
    FROM public.profiles p
    WHERE s.company_id = p_company_id
      AND s.revoked_at IS NULL
      AND p.id = s.user_id
      AND p.company_id = p_company_id
      AND (COALESCE(p.is_admin_blocked, false) OR COALESCE(p.is_suspended, false))
    RETURNING s.id
  )
  SELECT COUNT(*)::int INTO v_revoked_blocked FROM revoked;

  -- Revoke active seats for users manually blocked by company admin.
  -- These users must stay blocked after subscription renewal until admin unblocks them explicitly.
  WITH revoked AS (
    UPDATE public.company_seat_assignments s
    SET
      revoked_at = now(),
      reason = 'repair_manual_admin_blocked'
    FROM public.profiles p
    WHERE s.company_id = p_company_id
      AND s.revoked_at IS NULL
      AND p.id = s.user_id
      AND p.company_id = p_company_id
      AND lower(COALESCE(p.blocked_reason, '')) IN ('manual', 'admin_block', 'admin_blocked')
    RETURNING s.id
  )
  SELECT COUNT(*)::int INTO v_revoked_manual_blocked FROM revoked;

  -- Revoke duplicate active seats (keep latest per company/user).
  WITH ranked AS (
    SELECT
      s.id,
      ROW_NUMBER() OVER (
        PARTITION BY s.company_id, s.user_id
        ORDER BY s.assigned_at DESC, s.id DESC
      ) AS rn
    FROM public.company_seat_assignments s
    WHERE s.company_id = p_company_id
      AND s.revoked_at IS NULL
  ),
  revoked AS (
    UPDATE public.company_seat_assignments s
    SET
      revoked_at = now(),
      reason = 'repair_duplicate_active'
    FROM ranked r
    WHERE s.id = r.id
      AND r.rn > 1
      AND s.revoked_at IS NULL
    RETURNING s.id
  )
  SELECT COUNT(*)::int INTO v_revoked_duplicates FROM revoked;

  v_subscription_active := public.billing_can_edit_company(p_company_id);

  -- Re-sync profile license states from canonical seat state.
  WITH synced AS (
    UPDATE public.profiles p
    SET
      license_state = CASE
        WHEN lower(COALESCE(p.role, '')) = 'admin' THEN 'active'
        WHEN COALESCE(p.is_admin_blocked, false)
          OR COALESCE(p.is_suspended, false)
          OR lower(COALESCE(p.blocked_reason, '')) IN ('manual', 'admin_block', 'admin_blocked')
          THEN 'blocked_by_license'
        WHEN NOT v_subscription_active THEN 'blocked_by_license'
        WHEN EXISTS (
          SELECT 1
          FROM public.company_seat_assignments s
          WHERE s.company_id = p_company_id
            AND s.user_id = p.id
            AND s.revoked_at IS NULL
        ) THEN 'active'
        ELSE 'blocked_by_license'
      END,
      blocked_reason = CASE
        WHEN COALESCE(p.is_admin_blocked, false)
          OR COALESCE(p.is_suspended, false)
          OR lower(COALESCE(p.blocked_reason, '')) IN ('manual', 'admin_block', 'admin_blocked')
          THEN COALESCE(NULLIF(p.blocked_reason, ''), 'admin_blocked')
        WHEN lower(COALESCE(p.role, '')) = 'admin'
          THEN NULL
        WHEN NOT v_subscription_active
          THEN COALESCE(p.blocked_reason, 'subscription_expired')
        WHEN EXISTS (
          SELECT 1
          FROM public.company_seat_assignments s
          WHERE s.company_id = p_company_id
            AND s.user_id = p.id
            AND s.revoked_at IS NULL
        ) THEN NULL
        ELSE COALESCE(p.blocked_reason, 'no_paid_seat')
      END
    WHERE p.company_id = p_company_id
    RETURNING p.id
  )
  SELECT COUNT(*)::int INTO v_profiles_synced FROM synced;

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'revoked_not_in_company', v_revoked_not_in_company,
    'revoked_admin_blocked', v_revoked_blocked,
    'revoked_manual_admin_blocked', v_revoked_manual_blocked,
    'revoked_duplicates', v_revoked_duplicates,
    'profiles_synced', v_profiles_synced,
    'used_seats', public.company_used_seats(p_company_id),
    'paid_seats', public.company_paid_seats_total(p_company_id)
  );
END;
$$;

-- 3) Safe assign: normalize seat pool before seat-limit check.
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
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_user_id
      AND p.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'user % is not in company %', p_user_id, p_company_id;
  END IF;

  -- Heal stale seat state before checking seat limit.
  PERFORM public.repair_company_seat_pool(p_company_id);

  IF public.user_has_active_seat(p_company_id, p_user_id) THEN
    PERFORM public.sync_member_license_state(p_company_id, p_user_id);
    RETURN jsonb_build_object(
      'ok', true,
      'already_assigned', true,
      'company_id', p_company_id,
      'user_id', p_user_id
    );
  END IF;

  v_used := public.company_used_seats(p_company_id);
  v_paid := public.company_paid_seats_total(p_company_id);

  IF v_used >= v_paid THEN
    RAISE EXCEPTION 'seat limit exceeded: used %, paid %', v_used, v_paid USING ERRCODE='42501';
  END IF;

  INSERT INTO public.company_seat_assignments (company_id, user_id, reason)
  VALUES (p_company_id, p_user_id, 'manual')
  ON CONFLICT (company_id, user_id) WHERE revoked_at IS NULL DO NOTHING;

  UPDATE public.profiles
  SET
    license_state = 'active',
    blocked_reason = NULL
  WHERE id = p_user_id
    AND company_id = p_company_id;

  RETURN jsonb_build_object('ok', true, 'company_id', p_company_id, 'user_id', p_user_id);
END;
$$;

-- 4) Remove ambiguous column reference in access-state RPC.
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
  v_has_members boolean := false;
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

  SELECT * INTO v_sub
  FROM public.company_subscriptions cs
  WHERE cs.company_id = p_company_id
  LIMIT 1;

  v_paid := public.company_paid_seats_total(p_company_id);
  v_used := public.company_used_seats(p_company_id);

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.company_id = p_company_id
       OR EXISTS (
         SELECT 1
         FROM public.company_seat_assignments s
         WHERE s.company_id = p_company_id
           AND s.user_id = p.id
       )
  )
  INTO v_has_members;

  IF v_has_members THEN
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
       OR EXISTS (
         SELECT 1
         FROM public.company_seat_assignments s
         WHERE s.company_id = p_company_id
           AND s.user_id = p.id
       )
    ORDER BY COALESCE(NULLIF(p.full_name, ''), trim(concat_ws(' ', p.first_name, p.last_name)), p.email, p.id::text);
  ELSE
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
      NULL::uuid,
      NULL::text,
      NULL::text,
      false,
      'active'::text,
      false;
  END IF;
END;
$$;

-- 4.1) Access guard: when subscription is read-only/expired, non-admin users are blocked
-- regardless of stale profile.license_state and are auto-unblocked after renewal.
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
  v_is_owner_or_admin boolean := false;
  v_subscription_active boolean := true;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_uid
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RETURN QUERY
    SELECT
      v_uid,
      NULL::uuid,
      false,
      'active'::text,
      false,
      false,
      'profile_missing'::text,
      'Profile not found'::text;
    RETURN;
  END IF;

  IF v_profile.company_id IS NOT NULL THEN
    PERFORM public.apply_pending_seat_change_if_due(v_profile.company_id);
    v_has_seat := public.user_has_active_seat(v_profile.company_id, v_uid);
    v_is_owner_or_admin :=
      public.is_company_owner(v_profile.company_id)
      OR lower(COALESCE(v_profile.role, '')) = 'admin';
    v_subscription_active := public.billing_can_edit_company(v_profile.company_id);
  END IF;

  v_admin_blocked := COALESCE(v_profile.is_admin_blocked, false)
    OR COALESCE(v_profile.is_suspended, false)
    OR lower(COALESCE(v_profile.blocked_reason, '')) IN ('manual', 'admin_block', 'admin_blocked');
  v_license_state := CASE
    WHEN v_is_owner_or_admin THEN 'active'
    WHEN NOT v_subscription_active THEN 'blocked_by_license'
    ELSE COALESCE(v_profile.license_state, CASE WHEN v_has_seat THEN 'active' ELSE 'blocked_by_license' END)
  END;

  IF v_admin_blocked THEN
    v_can_login := false;
    v_block_code := 'admin_blocked';
    v_block_message := 'Access blocked by administrator';
  ELSIF v_is_owner_or_admin THEN
    v_can_login := true;
    v_block_code := NULL;
    v_block_message := NULL;
  ELSIF (NOT v_subscription_active) OR v_license_state = 'blocked_by_license' OR NOT v_has_seat THEN
    v_can_login := false;
    v_block_code := 'blocked_by_license';
    IF NOT v_subscription_active THEN
      v_block_message := 'Subscription expired. Renew subscription to continue.';
    ELSE
      v_block_message := 'No paid seat available. Contact your company administrator.';
    END IF;
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

GRANT EXECUTE ON FUNCTION public.repair_company_seat_pool(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_access_state() TO authenticated;

-- 5) One-time global repair for existing data.
DO $$
DECLARE
  v_company_id uuid;
BEGIN
  FOR v_company_id IN
    SELECT c.id FROM public.companies c
  LOOP
    BEGIN
      PERFORM public.repair_company_seat_pool(v_company_id);
    EXCEPTION WHEN OTHERS THEN
      -- do not block migration on a single company issue
      NULL;
    END;
  END LOOP;
END;
$$;

COMMIT;
