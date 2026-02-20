-- sql/14_fix_owner_ids_alias_and_repair_seats.sql
-- Fix owner_ids alias in enforce_seat_limit and repair seat/license state.

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
    SELECT p.id AS user_id
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

-- Global state repair:
-- 1) mark non-admins without seat as blocked_by_license
-- 2) mark admins and users with active seat as active
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
