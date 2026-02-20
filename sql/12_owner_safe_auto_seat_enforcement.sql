-- sql/12_owner_safe_auto_seat_enforcement.sql
-- Owner-safe automatic seat enforcement with deterministic priorities.
--
-- Priorities when reducing paid seats:
-- 1) inactive users first (last_seen_at is NULL or older than 7 days)
-- 2) role priority: worker first, then dispatcher, then others
-- 3) fewer assigned orders first
-- 4) older last_seen_at first, then most recently assigned seat
--
-- Owner/admin is never blocked by license.

BEGIN;

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
  v_revoked int := 0;
  v_revoked_user_ids uuid[] := ARRAY[]::uuid[];
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

  WITH owner_ids AS (
    SELECT p.id
    FROM public.profiles p
    WHERE p.company_id = p_company_id
      AND lower(COALESCE(p.role, '')) = 'admin'
  ),
  workload AS (
    SELECT o.assigned_to::uuid AS user_id, COUNT(*)::int AS orders_count
    FROM public.orders o
    WHERE o.company_id = p_company_id
      AND o.assigned_to IS NOT NULL
    GROUP BY o.assigned_to
  ),
  ranked AS (
    SELECT
      s.id AS seat_id,
      s.user_id,
      s.assigned_at,
      p.role,
      p.last_seen_at,
      COALESCE(w.orders_count, 0) AS orders_count
    FROM public.company_seat_assignments s
    JOIN public.profiles p ON p.id = s.user_id
    LEFT JOIN workload w ON w.user_id = s.user_id
    LEFT JOIN owner_ids oi ON oi.user_id = s.user_id
    WHERE s.company_id = p_company_id
      AND s.revoked_at IS NULL
      AND oi.user_id IS NULL
  ),
  victims AS (
    SELECT r.seat_id, r.user_id
    FROM ranked r
    ORDER BY
      CASE
        WHEN r.last_seen_at IS NULL OR r.last_seen_at < now() - interval '7 days' THEN 0
        ELSE 1
      END ASC,
      CASE lower(COALESCE(r.role, ''))
        WHEN 'worker' THEN 0
        WHEN 'dispatcher' THEN 1
        WHEN 'admin' THEN 2
        ELSE 3
      END ASC,
      r.orders_count ASC,
      COALESCE(r.last_seen_at, to_timestamp(0)) ASC,
      r.assigned_at DESC,
      r.seat_id DESC
    LIMIT v_to_revoke
  ),
  revoked AS (
    UPDATE public.company_seat_assignments s
    SET
      revoked_at = now(),
      reason = 'auto_downgrade'
    FROM victims v
    WHERE s.id = v.seat_id
      AND s.revoked_at IS NULL
    RETURNING s.user_id
  )
  SELECT
    COUNT(*)::int,
    COALESCE(array_agg(user_id), ARRAY[]::uuid[])
  INTO v_revoked, v_revoked_user_ids
  FROM revoked;

  IF v_revoked > 0 THEN
    UPDATE public.profiles p
    SET
      license_state = 'blocked_by_license',
      blocked_reason = 'auto_downgrade'
    WHERE p.company_id = p_company_id
      AND p.id = ANY(v_revoked_user_ids);
  END IF;

  RETURN v_revoked;
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
  v_is_owner_or_admin boolean := false;
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
    SELECT v_uid, NULL::uuid, false, 'active'::text, false, false, 'profile_missing'::text, 'Профиль не найден'::text;
    RETURN;
  END IF;

  IF v_profile.company_id IS NOT NULL THEN
    PERFORM public.apply_pending_seat_change_if_due(v_profile.company_id);
    v_has_seat := public.user_has_active_seat(v_profile.company_id, v_uid);
    v_is_owner_or_admin :=
      public.is_company_owner(v_profile.company_id)
      OR lower(COALESCE(v_profile.role, '')) = 'admin';
  END IF;

  v_admin_blocked := COALESCE(v_profile.is_admin_blocked, false) OR COALESCE(v_profile.is_suspended, false);
  v_license_state := COALESCE(v_profile.license_state, CASE WHEN v_has_seat THEN 'active' ELSE 'blocked_by_license' END);

  IF v_admin_blocked THEN
    v_can_login := false;
    v_block_code := 'admin_blocked';
    v_block_message := 'Доступ заблокирован, обратитесь к администратору';
  ELSIF v_is_owner_or_admin THEN
    -- Owner/admin must always be able to log in.
    v_can_login := true;
    v_block_code := NULL;
    v_block_message := NULL;
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

-- Reconcile existing rows: non-admin users without active seat must be blocked by license.
UPDATE public.profiles p
SET
  license_state = 'blocked_by_license',
  blocked_reason = COALESCE(p.blocked_reason, 'no_paid_seat')
WHERE p.company_id IS NOT NULL
  AND lower(COALESCE(p.role, '')) <> 'admin'
  AND NOT EXISTS (
    SELECT 1
    FROM public.company_seat_assignments s
    WHERE s.company_id = p.company_id
      AND s.user_id = p.id
      AND s.revoked_at IS NULL
  );

-- Users with active seat (and admins) stay active.
UPDATE public.profiles p
SET
  license_state = 'active',
  blocked_reason = NULL
WHERE p.company_id IS NOT NULL
  AND (
    lower(COALESCE(p.role, '')) = 'admin'
    OR EXISTS (
      SELECT 1
      FROM public.company_seat_assignments s
      WHERE s.company_id = p.company_id
        AND s.user_id = p.id
        AND s.revoked_at IS NULL
    )
  );

COMMIT;
