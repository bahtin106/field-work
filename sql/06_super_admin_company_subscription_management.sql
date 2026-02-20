-- sql/06_super_admin_company_subscription_management.sql
-- Super-admin subscription management: full manual controls for any company.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_set_company_subscription_super(uuid, text, text, timestamptz, int, int, int);

CREATE OR REPLACE FUNCTION public.admin_get_company_subscription_meta(p_company_id uuid)
RETURNS TABLE(
  company_id uuid,
  plan_code text,
  subscription_status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_period_days int,
  cancel_at_period_end boolean,
  source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_assert_super_admin();

  RETURN QUERY
  SELECT
    cs.company_id,
    bp.code AS plan_code,
    cs.status AS subscription_status,
    cs.current_period_start,
    cs.current_period_end,
    COALESCE(cs.grace_period_days, 0) AS grace_period_days,
    COALESCE(cs.cancel_at_period_end, false) AS cancel_at_period_end,
    cs.source
  FROM public.company_subscriptions cs
  LEFT JOIN public.billing_plans bp ON bp.id = cs.plan_id
  WHERE cs.company_id = p_company_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_company_subscription_addons(p_company_id uuid)
RETURNS TABLE(
  addon_code text,
  addon_name text,
  addon_unit text,
  quantity int,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_assert_super_admin();

  RETURN QUERY
  WITH sub AS (
    SELECT id
    FROM public.company_subscriptions
    WHERE company_id = p_company_id
    LIMIT 1
  )
  SELECT
    ba.code AS addon_code,
    ba.name AS addon_name,
    ba.unit AS addon_unit,
    COALESCE(csa.quantity, 0)::int AS quantity,
    ba.is_active
  FROM public.billing_addons ba
  LEFT JOIN sub s ON true
  LEFT JOIN public.company_subscription_addons csa
    ON csa.subscription_id = s.id
   AND csa.addon_id = ba.id
  ORDER BY ba.code;
END;
$$;

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
  v_plan_id uuid;
  v_status text;
  v_period_end timestamptz;
  v_grace int;
  v_cancel_at_period_end boolean;
  v_sub public.company_subscriptions%ROWTYPE;
  v_addon_extra_seat uuid;
  v_addon_extra_storage uuid;
  v_item jsonb;
  v_addon_code text;
  v_qty int;
  v_addon_id uuid;
BEGIN
  PERFORM public.admin_assert_super_admin();

  IF p_status IS NOT NULL AND p_status NOT IN ('trial', 'active', 'past_due', 'canceled', 'paused') THEN
    RAISE EXCEPTION 'unsupported status: %', p_status;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION 'company not found: %', p_company_id;
  END IF;

  SELECT * INTO v_existing
  FROM public.company_subscriptions
  WHERE company_id = p_company_id
  LIMIT 1;

  IF p_plan_code IS NOT NULL THEN
    SELECT id INTO v_plan_id
    FROM public.billing_plans
    WHERE code = p_plan_code
    LIMIT 1;

    IF v_plan_id IS NULL THEN
      RAISE EXCEPTION 'plan code not found: %', p_plan_code;
    END IF;
  ELSE
    v_plan_id := v_existing.plan_id;
  END IF;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'plan is required for company %', p_company_id;
  END IF;

  v_status := COALESCE(p_status, v_existing.status, 'active');
  v_period_end := COALESCE(p_period_end, v_existing.current_period_end, now() + interval '30 days');
  v_grace := GREATEST(0, COALESCE(p_grace_period_days, v_existing.grace_period_days, 7));
  v_cancel_at_period_end := COALESCE(p_cancel_at_period_end, v_existing.cancel_at_period_end, false);

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
    now(),
    v_period_end,
    v_cancel_at_period_end,
    v_grace,
    'admin'
  )
  ON CONFLICT (company_id)
  DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    grace_period_days = EXCLUDED.grace_period_days,
    source = 'admin',
    updated_at = now()
  RETURNING * INTO v_sub;

  IF p_addons_json IS NOT NULL THEN
    DELETE FROM public.company_subscription_addons
    WHERE subscription_id = v_sub.id;

    IF jsonb_typeof(p_addons_json) = 'array' THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_addons_json)
      LOOP
        v_addon_code := COALESCE(v_item->>'code', '');
        v_qty := GREATEST(0, COALESCE((v_item->>'quantity')::int, 0));
        IF v_qty <= 0 OR v_addon_code = '' THEN
          CONTINUE;
        END IF;

        SELECT id INTO v_addon_id
        FROM public.billing_addons
        WHERE code = v_addon_code
        LIMIT 1;

        IF v_addon_id IS NOT NULL THEN
          INSERT INTO public.company_subscription_addons(subscription_id, addon_id, quantity)
          VALUES (v_sub.id, v_addon_id, v_qty)
          ON CONFLICT (subscription_id, addon_id)
          DO UPDATE SET quantity = EXCLUDED.quantity;
        END IF;
      END LOOP;
    END IF;
  END IF;

  SELECT id INTO v_addon_extra_seat FROM public.billing_addons WHERE code = 'extra_seat' LIMIT 1;
  SELECT id INTO v_addon_extra_storage FROM public.billing_addons WHERE code = 'extra_storage_gb' LIMIT 1;

  IF p_extra_seats IS NOT NULL AND v_addon_extra_seat IS NOT NULL THEN
    DELETE FROM public.company_subscription_addons
    WHERE subscription_id = v_sub.id
      AND addon_id = v_addon_extra_seat;

    IF p_extra_seats > 0 THEN
      INSERT INTO public.company_subscription_addons(subscription_id, addon_id, quantity)
      VALUES (v_sub.id, v_addon_extra_seat, p_extra_seats)
      ON CONFLICT (subscription_id, addon_id)
      DO UPDATE SET quantity = EXCLUDED.quantity;
    END IF;
  END IF;

  IF p_extra_storage_gb IS NOT NULL AND v_addon_extra_storage IS NOT NULL THEN
    DELETE FROM public.company_subscription_addons
    WHERE subscription_id = v_sub.id
      AND addon_id = v_addon_extra_storage;

    IF p_extra_storage_gb > 0 THEN
      INSERT INTO public.company_subscription_addons(subscription_id, addon_id, quantity)
      VALUES (v_sub.id, v_addon_extra_storage, p_extra_storage_gb)
      ON CONFLICT (subscription_id, addon_id)
      DO UPDATE SET quantity = EXCLUDED.quantity;
    END IF;
  END IF;

  RETURN v_sub;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_company_subscription_meta(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_company_subscription_addons(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_company_subscription_super(uuid, text, text, timestamptz, int, int, int, boolean, jsonb) TO authenticated;

COMMIT;
