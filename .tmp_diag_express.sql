WITH c AS (
  SELECT id, name
  FROM public.companies
  WHERE name ILIKE '%Экспресс полив%'
)
SELECT
  c.id,
  c.name,
  cs.current_period_end,
  ((date_trunc('day', cs.current_period_end AT TIME ZONE 'UTC')::date) - ((now() AT TIME ZONE 'UTC')::date))::int AS days_left_utc
FROM c
LEFT JOIN public.company_subscriptions cs ON cs.company_id = c.id;
