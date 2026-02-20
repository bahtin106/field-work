-- sql/11_fix_enforce_seat_limit_permissions.sql
-- Fix: enforce_seat_limit must work in trigger/system context without license-admin auth.

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
  v_revoked_user_ids uuid[];
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

  WITH victims AS (
    SELECT s.id, s.user_id
    FROM public.company_seat_assignments s
    WHERE s.company_id = p_company_id
      AND s.revoked_at IS NULL
    ORDER BY s.assigned_at DESC, s.id DESC
    LIMIT v_to_revoke
  ),
  revoked AS (
    UPDATE public.company_seat_assignments s
    SET
      revoked_at = now(),
      reason = 'auto_downgrade'
    FROM victims v
    WHERE s.id = v.id
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
      blocked_reason = COALESCE(p.blocked_reason, 'auto_downgrade')
    WHERE p.company_id = p_company_id
      AND p.id = ANY(v_revoked_user_ids);
  END IF;

  RETURN v_revoked;
END;
$$;

COMMIT;
