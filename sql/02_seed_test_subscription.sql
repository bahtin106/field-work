-- sql/02_seed_test_subscription.sql
-- Idempotent seed for seat-based subscription test data.
-- Before run: set v_company_id and v_paid_seats_total in the DO block.

BEGIN;

DO $$
DECLARE
  v_company_id uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_paid_seats_total int := 5;
  v_period_days int := 30;
  v_sub public.company_subscriptions%ROWTYPE;
BEGIN
  IF v_company_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Set v_company_id in sql/02_seed_test_subscription.sql before execution';
  END IF;

  IF v_paid_seats_total < 1 THEN
    RAISE EXCEPTION 'v_paid_seats_total must be >= 1';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v_company_id) THEN
    RAISE EXCEPTION 'Company not found: %', v_company_id;
  END IF;

  PERFORM public.ensure_company_subscription(v_company_id);

  UPDATE public.company_subscriptions
  SET
    status = 'active',
    current_period_start = now(),
    current_period_end = now() + make_interval(days => v_period_days),
    paid_seats_total = v_paid_seats_total,
    paid_seats_additional = GREATEST(0, v_paid_seats_total - 1),
    pending_paid_seats_total = NULL,
    pending_apply_at = NULL,
    source = 'admin',
    updated_at = now()
  WHERE company_id = v_company_id
  RETURNING * INTO v_sub;

  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'Subscription row not found for company: %', v_company_id;
  END IF;

  -- Reset active seats and assign them to first users by priority.
  UPDATE public.company_seat_assignments
  SET revoked_at = now(), reason = 'seed_reset'
  WHERE company_id = v_company_id
    AND revoked_at IS NULL;

  INSERT INTO public.company_seat_assignments (company_id, user_id, reason)
  SELECT
    v_company_id,
    p.id,
    'seed'
  FROM public.profiles p
  WHERE p.company_id = v_company_id
    AND COALESCE(p.is_admin_blocked, false) = false
    AND COALESCE(p.is_suspended, false) = false
  ORDER BY
    CASE WHEN lower(COALESCE(p.role, '')) = 'admin' THEN 0 ELSE 1 END,
    p.created_at NULLS LAST,
    p.id
  LIMIT v_paid_seats_total
  ON CONFLICT DO NOTHING;

  UPDATE public.profiles p
  SET
    license_state = CASE
      WHEN public.user_has_active_seat(v_company_id, p.id) THEN 'active'
      ELSE 'blocked_by_license'
    END,
    blocked_reason = CASE
      WHEN public.user_has_active_seat(v_company_id, p.id) THEN NULL
      ELSE 'no_paid_seat'
    END
  WHERE p.company_id = v_company_id;
END;
$$;

COMMIT;
