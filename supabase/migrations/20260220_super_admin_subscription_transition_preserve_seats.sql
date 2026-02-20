-- Patch after initial renewal fix:
-- preserve historical seats on subscription status transitions (active<->expired)
-- when extra seats are not explicitly edited and request carries p_extra_seats = 0.

CREATE OR REPLACE FUNCTION public.admin_set_company_subscription_super(
  p_company_id uuid,
  p_plan_code text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_period_end timestamptz DEFAULT NULL,
  p_grace_period_days int DEFAULT NULL,
  p_extra_seats int DEFAULT NULL,
  p_extra_storage_gb int DEFAULT NULL,
  p_cancel_at_period_end boolean DEFAULT NULL,
  p_addons_json jsonb DEFAULT NULL
)
RETURNS public.company_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.company_subscriptions%ROWTYPE;
  v_sub public.company_subscriptions%ROWTYPE;
  v_status text;
  v_period_end timestamptz;
  v_cancel_at_period_end boolean;
  v_addon_extra_seat uuid;
  v_plan_id uuid;
  v_paid_total int;
  v_effective_extra_seats int;
  v_existing_extra_seats int;
  v_is_expired_now boolean := false;
  v_was_active boolean := false;
  v_will_be_active boolean := false;
BEGIN
  PERFORM public.admin_assert_super_admin();

  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION 'company not found: %', p_company_id;
  END IF;

  SELECT id INTO v_plan_id
  FROM public.billing_plans
  WHERE code = 'subscription_base'
  LIMIT 1;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'base plan not found';
  END IF;

  v_existing := public.ensure_company_subscription(p_company_id);
  v_existing_extra_seats := GREATEST(0, COALESCE(v_existing.paid_seats_total, 1) - 1);
  v_is_expired_now := v_existing.current_period_end IS NULL OR v_existing.current_period_end < now();
  v_was_active := NOT v_is_expired_now;

  v_period_end := COALESCE(p_period_end, v_existing.current_period_end, now() + interval '30 days');
  v_status := COALESCE(
    CASE WHEN p_status IN ('active', 'expired') THEN p_status ELSE NULL END,
    CASE WHEN v_period_end >= now() THEN 'active' ELSE 'expired' END
  );
  v_cancel_at_period_end := COALESCE(p_cancel_at_period_end, v_existing.cancel_at_period_end, false);
  v_will_be_active := v_period_end > now();

  -- Preserve seat plan on active<->expired transitions unless seats are edited explicitly.
  v_effective_extra_seats := p_extra_seats;
  IF p_extra_seats IS NOT NULL
     AND p_extra_seats = 0
     AND v_existing_extra_seats > 0
     AND (
       (NOT v_was_active AND v_will_be_active)
       OR (v_was_active AND NOT v_will_be_active)
     )
  THEN
    v_effective_extra_seats := v_existing_extra_seats;
  END IF;

  INSERT INTO public.company_subscriptions (
    company_id,
    plan_id,
    status,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    grace_period_days,
    source
  ) VALUES (
    p_company_id,
    v_plan_id,
    v_status,
    COALESCE(v_existing.current_period_start, now()),
    v_period_end,
    v_cancel_at_period_end,
    0,
    'admin'
  )
  ON CONFLICT (company_id)
  DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    grace_period_days = 0,
    source = 'admin',
    updated_at = now()
  RETURNING * INTO v_sub;

  SELECT id INTO v_addon_extra_seat
  FROM public.billing_addons
  WHERE code = 'extra_seat'
  LIMIT 1;

  IF v_addon_extra_seat IS NOT NULL AND v_effective_extra_seats IS NOT NULL THEN
    DELETE FROM public.company_subscription_addons
    WHERE subscription_id = v_sub.id
      AND addon_id = v_addon_extra_seat;

    IF v_effective_extra_seats > 0 THEN
      INSERT INTO public.company_subscription_addons(subscription_id, addon_id, quantity)
      VALUES (v_sub.id, v_addon_extra_seat, v_effective_extra_seats)
      ON CONFLICT (subscription_id, addon_id)
      DO UPDATE SET quantity = EXCLUDED.quantity;
    END IF;
  END IF;

  IF v_effective_extra_seats IS NOT NULL THEN
    v_paid_total := GREATEST(1, 1 + GREATEST(0, v_effective_extra_seats));
    UPDATE public.company_subscriptions
    SET
      paid_seats_total = v_paid_total,
      paid_seats_additional = GREATEST(0, v_paid_total - 1),
      updated_at = now()
    WHERE company_id = p_company_id
    RETURNING * INTO v_sub;

    PERFORM public.enforce_seat_limit(p_company_id);
  END IF;

  PERFORM public.repair_company_seat_pool(p_company_id);

  RETURN v_sub;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_company_subscription_super(uuid, text, text, timestamptz, int, int, int, boolean, jsonb) TO authenticated;
