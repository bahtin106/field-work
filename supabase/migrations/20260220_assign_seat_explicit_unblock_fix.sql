-- Fix: explicit admin unblock must really unblock manual seat blocks.
-- If admin assigns a seat intentionally, manual/admin_block markers should be cleared
-- unless hard admin flags (is_admin_blocked/is_suspended) are still set.

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

  UPDATE public.profiles p
  SET
    license_state = CASE
      WHEN COALESCE(p.is_admin_blocked, false)
        OR COALESCE(p.is_suspended, false)
        THEN 'blocked_by_license'
      ELSE 'active'
    END,
    blocked_reason = CASE
      WHEN COALESCE(p.is_admin_blocked, false)
        OR COALESCE(p.is_suspended, false)
        THEN COALESCE(NULLIF(p.blocked_reason, ''), 'admin_blocked')
      ELSE NULL
    END
  WHERE p.id = p_user_id
    AND p.company_id = p_company_id;

  RETURN jsonb_build_object('ok', true, 'company_id', p_company_id, 'user_id', p_user_id);
END;
$$;
