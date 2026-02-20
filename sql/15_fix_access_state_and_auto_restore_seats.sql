-- sql/15_fix_access_state_and_auto_restore_seats.sql
-- Fix empty member list in access RPC and auto-restore license-blocked users
-- when paid seats increase.

BEGIN;

CREATE OR REPLACE FUNCTION public.auto_restore_seats_after_increase(p_company_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid int;
  v_used int;
  v_free int;
  v_assigned int := 0;
  v_user_id uuid;
BEGIN
  IF p_company_id IS NULL THEN
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
      WHERE (
          p.company_id = p_company_id
          OR EXISTS (
            SELECT 1
            FROM public.company_seat_assignments hs
            WHERE hs.company_id = p_company_id
              AND hs.user_id = p.id
          )
        )
        AND COALESCE(p.is_admin_blocked, false) = false
        AND COALESCE(p.is_suspended, false) = false
        AND COALESCE(p.license_state, 'active') = 'blocked_by_license'
        AND NOT public.user_has_active_seat(p_company_id, p.id)
    )
    SELECT c.user_id
    FROM candidates c
    ORDER BY
      CASE WHEN COALESCE(c.blocked_reason, '') = 'auto_downgrade' THEN 0 ELSE 1 END ASC,
      COALESCE(c.last_seen_at, to_timestamp(0)) DESC,
      COALESCE(c.last_assigned_at, to_timestamp(0)) DESC,
      c.user_id
    LIMIT v_free
  LOOP
    INSERT INTO public.company_seat_assignments (company_id, user_id, reason)
    VALUES (p_company_id, v_user_id, 'auto_restore')
    ON CONFLICT DO NOTHING;

    IF public.user_has_active_seat(p_company_id, v_user_id) THEN
      UPDATE public.profiles p
      SET
        license_state = 'active',
        blocked_reason = NULL
      WHERE p.id = v_user_id
        AND COALESCE(p.is_admin_blocked, false) = false
        AND COALESCE(p.is_suspended, false) = false;

      v_assigned := v_assigned + 1;
    END IF;
  END LOOP;

  RETURN v_assigned;
END;
$$;

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
  FROM public.company_subscriptions
  WHERE company_id = p_company_id
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
    ORDER BY member_name;
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

CREATE OR REPLACE FUNCTION public.trg_company_subscriptions_enforce_seats_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.paid_seats_total IS DISTINCT FROM OLD.paid_seats_total THEN
    IF NEW.paid_seats_total < OLD.paid_seats_total THEN
      PERFORM public.enforce_seat_limit(NEW.company_id);
    ELSE
      PERFORM public.auto_restore_seats_after_increase(NEW.company_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_company_id uuid;
BEGIN
  FOR v_company_id IN
    SELECT cs.company_id
    FROM public.company_subscriptions cs
    WHERE cs.company_id IS NOT NULL
  LOOP
    PERFORM public.auto_restore_seats_after_increase(v_company_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_restore_seats_after_increase(uuid) TO authenticated;

COMMIT;

