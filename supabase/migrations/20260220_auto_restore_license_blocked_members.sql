-- Auto-restore users blocked only by license after subscription/seat recovery.
-- Manual/admin blocked users must stay blocked until admin explicitly unblocks them.

BEGIN;

CREATE OR REPLACE FUNCTION public.auto_restore_license_blocked_members(p_company_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid int := 0;
  v_used int := 0;
  v_free int := 0;
  v_restored int := 0;
  v_user_id uuid;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Restore is meaningful only for active subscription period.
  IF NOT public.billing_can_edit_company(p_company_id) THEN
    RETURN 0;
  END IF;

  v_paid := public.company_paid_seats_total(p_company_id);
  v_used := public.company_used_seats(p_company_id);
  v_free := GREATEST(0, v_paid - v_used);

  IF v_free <= 0 THEN
    RETURN 0;
  END IF;

  FOR v_user_id IN
    WITH candidates AS (
      SELECT
        p.id AS user_id,
        p.last_seen_at,
        p.blocked_reason,
        (
          SELECT MAX(s.assigned_at)
          FROM public.company_seat_assignments s
          WHERE s.company_id = p_company_id
            AND s.user_id = p.id
        ) AS last_assigned_at
      FROM public.profiles p
      WHERE p.company_id = p_company_id
        AND lower(COALESCE(p.role, '')) <> 'admin'
        AND COALESCE(p.is_admin_blocked, false) = false
        AND COALESCE(p.is_suspended, false) = false
        AND lower(COALESCE(p.blocked_reason, '')) NOT IN ('manual', 'admin_block', 'admin_blocked')
        AND COALESCE(p.license_state, 'active') = 'blocked_by_license'
        AND NOT public.user_has_active_seat(p_company_id, p.id)
    )
    SELECT c.user_id
    FROM candidates c
    ORDER BY
      CASE
        WHEN lower(COALESCE(c.blocked_reason, '')) IN ('no_paid_seat', 'subscription_expired', 'auto_downgrade', 'license_block')
          THEN 0
        ELSE 1
      END ASC,
      COALESCE(c.last_seen_at, to_timestamp(0)) DESC,
      COALESCE(c.last_assigned_at, to_timestamp(0)) DESC,
      c.user_id
    LIMIT v_free
  LOOP
    INSERT INTO public.company_seat_assignments (company_id, user_id, reason)
    VALUES (p_company_id, v_user_id, 'auto_restore')
    ON CONFLICT (company_id, user_id) WHERE revoked_at IS NULL DO NOTHING;

    IF public.user_has_active_seat(p_company_id, v_user_id) THEN
      v_restored := v_restored + 1;
    END IF;
  END LOOP;

  RETURN v_restored;
END;
$$;

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
  v_restored_auto int := 0;
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

  -- Restore only license-blocked users (not manual/admin block) when seats are available.
  IF v_subscription_active THEN
    v_restored_auto := public.auto_restore_license_blocked_members(p_company_id);
  END IF;

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
    'restored_license_blocked', v_restored_auto,
    'profiles_synced', v_profiles_synced,
    'used_seats', public.company_used_seats(p_company_id),
    'paid_seats', public.company_paid_seats_total(p_company_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_restore_license_blocked_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_company_seat_pool(uuid) TO authenticated;

COMMIT;
