CREATE OR REPLACE FUNCTION public.get_company_entitlements(p_company_id uuid)
RETURNS TABLE(
  company_id uuid,
  is_owner boolean,
  plan_code text,
  plan_name text,
  status text,
  current_period_end timestamptz,
  grace_period_days int,
  can_edit boolean,
  days_left int,
  allowed_seats int,
  used_seats int,
  allowed_storage_gb int,
  used_storage_gb numeric,
  features jsonb,
  addons jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_member boolean;
  v_is_owner boolean;
  v_sub public.company_subscriptions%ROWTYPE;
  v_policy text;
BEGIN
  v_is_member := public.is_company_member(p_company_id);
  v_is_owner := public.is_company_owner(p_company_id);

  IF NOT v_is_member AND NOT v_is_owner THEN
    RAISE EXCEPTION 'access denied to company %', p_company_id USING ERRCODE = '42501';
  END IF;

  v_sub := public.ensure_company_subscription(p_company_id);
  v_policy := public.company_seat_overlimit_policy(p_company_id);

  RETURN QUERY
  WITH used AS (
    SELECT public.company_used_seats(p_company_id) AS used_seats,
           0::numeric AS used_storage_gb
  ),
  addon_rows AS (
    SELECT ba.code, ba.unit, csa.quantity, ba.config
    FROM public.company_subscription_addons csa
    JOIN public.billing_addons ba ON ba.id = csa.addon_id
    WHERE csa.subscription_id = v_sub.id
  ),
  addon_agg AS (
    SELECT
      COALESCE(SUM(CASE WHEN code = 'extra_seat' THEN quantity ELSE 0 END), 0)::int AS extra_seats,
      COALESCE(
        jsonb_object_agg(code, jsonb_build_object('unit', unit, 'quantity', quantity, 'config', config))
          FILTER (WHERE code IS NOT NULL),
        '{}'::jsonb
      ) AS addons_json
    FROM addon_rows
  )
  SELECT
    p_company_id AS company_id,
    v_is_owner AS is_owner,
    CASE WHEN v_is_owner THEN 'subscription_base' ELSE NULL END AS plan_code,
    CASE WHEN v_is_owner THEN 'Subscription' ELSE NULL END AS plan_name,
    CASE WHEN v_sub.current_period_end >= now() THEN 'active' ELSE 'expired' END AS status,
    v_sub.current_period_end,
    0 AS grace_period_days,
    public.billing_can_edit_company(p_company_id) AS can_edit,
    GREATEST(
      0,
      (
        (date_trunc('day', v_sub.current_period_end AT TIME ZONE 'UTC')::date)
        - ((now() AT TIME ZONE 'UTC')::date)
      )::int
    ) AS days_left,
    CASE WHEN v_is_owner THEN (1 + COALESCE(a.extra_seats, 0))::int ELSE NULL END AS allowed_seats,
    u.used_seats,
    NULL::int AS allowed_storage_gb,
    u.used_storage_gb,
    jsonb_build_object(
      'seat_policy', v_policy,
      'is_over_limit', (u.used_seats > (1 + COALESCE(a.extra_seats, 0))),
      'over_limit_by', GREATEST(0, u.used_seats - (1 + COALESCE(a.extra_seats, 0))),
      'can_add_members', public.can_company_add_member(p_company_id)
    ) AS features,
    CASE WHEN v_is_owner THEN a.addons_json ELSE '{}'::jsonb END AS addons
  FROM used u
  CROSS JOIN addon_agg a;
END;
$$;
