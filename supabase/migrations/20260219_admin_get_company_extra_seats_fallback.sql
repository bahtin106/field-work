-- Preserve paid seats when renewing an expired subscription from super-admin UI.
-- If addon rows are absent/outdated, derive extra_seats from paid_seats_total.

CREATE OR REPLACE FUNCTION public.admin_get_company(p_company_id uuid)
RETURNS TABLE(
  company_id uuid,
  name text,
  timezone text,
  currency text,
  employees_count int,
  plan_code text,
  subscription_status text,
  current_period_end timestamptz,
  grace_period_days int,
  extra_seats int,
  extra_storage_gb int,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_assert_super_admin();

  RETURN QUERY
  WITH addon_rows AS (
    SELECT ba.code, csa.quantity
    FROM public.company_subscriptions cs
    JOIN public.company_subscription_addons csa ON csa.subscription_id = cs.id
    JOIN public.billing_addons ba ON ba.id = csa.addon_id
    WHERE cs.company_id = p_company_id
  )
  SELECT
    c.id AS company_id,
    c.name,
    c.timezone,
    c.currency,
    public.admin_company_employees_count(c.id) AS employees_count,
    bp.code AS plan_code,
    CASE
      WHEN cs.current_period_end IS NULL OR cs.current_period_end < now() THEN 'expired'
      ELSE 'active'
    END AS subscription_status,
    cs.current_period_end,
    COALESCE(cs.grace_period_days, 0) AS grace_period_days,
    GREATEST(
      COALESCE((SELECT SUM(quantity)::int FROM addon_rows WHERE code = 'extra_seat'), 0),
      GREATEST(0, COALESCE(cs.paid_seats_total, 1) - 1)
    ) AS extra_seats,
    COALESCE((SELECT SUM(quantity)::int FROM addon_rows WHERE code = 'extra_storage_gb'), 0) AS extra_storage_gb,
    c.created_at,
    c.updated_at
  FROM public.companies c
  LEFT JOIN public.company_subscriptions cs ON cs.company_id = c.id
  LEFT JOIN public.billing_plans bp ON bp.id = cs.plan_id
  WHERE c.id = p_company_id
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_company(uuid) TO authenticated;
