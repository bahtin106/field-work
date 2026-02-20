-- sql/02_seed_manual_subscription.sql
-- Idempotent manual seed for plans/addons/subscription.
-- Replace target_company_id below before running.

BEGIN;

WITH params AS (
  SELECT
    'a8f52d3f-c189-4df2-9690-b34a26d2e114'::uuid AS target_company_id,
    now() AS ts_now
)
INSERT INTO public.billing_plans (code, name, base_price_month, included_seats, included_storage_gb, features, is_active)
VALUES
  ('solo', 'Solo', 990, 1, 5, '{"basic_requests": true, "analytics": false, "ai": false}'::jsonb, true),
  ('team', 'Team', 2990, 5, 50, '{"basic_requests": true, "analytics": true, "ai": false}'::jsonb, true),
  ('pro',  'Pro',  7990, 20, 200, '{"basic_requests": true, "analytics": true, "ai": true}'::jsonb, true)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  base_price_month = EXCLUDED.base_price_month,
  included_seats = EXCLUDED.included_seats,
  included_storage_gb = EXCLUDED.included_storage_gb,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active;

INSERT INTO public.billing_addons (code, name, unit, price_month, config, is_active)
VALUES
  ('extra_seat', 'Extra seat', 'seat', 350, '{}'::jsonb, true),
  ('extra_storage_gb', 'Extra storage (GB)', 'gb', 50, '{}'::jsonb, true),
  ('crm_integration', 'CRM integration', 'flag', 1490, '{"provider":"generic"}'::jsonb, true),
  ('ai_pack', 'AI pack', 'flag', 1990, '{"tier":"base"}'::jsonb, true)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  unit = EXCLUDED.unit,
  price_month = EXCLUDED.price_month,
  config = EXCLUDED.config,
  is_active = EXCLUDED.is_active;

WITH p AS (
  SELECT id AS plan_id FROM public.billing_plans WHERE code = 'team' LIMIT 1
),
params AS (
  SELECT 'a8f52d3f-c189-4df2-9690-b34a26d2e114'::uuid AS target_company_id
)
INSERT INTO public.company_subscriptions (
  company_id,
  plan_id,
  status,
  current_period_start,
  current_period_end,
  grace_period_days,
  source
)
SELECT
  params.target_company_id,
  p.plan_id,
  'active',
  now(),
  now() + interval '30 days',
  7,
  'manual'
FROM p, params
ON CONFLICT (company_id)
DO UPDATE SET
  plan_id = EXCLUDED.plan_id,
  status = EXCLUDED.status,
  current_period_start = EXCLUDED.current_period_start,
  current_period_end = EXCLUDED.current_period_end,
  grace_period_days = EXCLUDED.grace_period_days,
  source = EXCLUDED.source,
  updated_at = now();

WITH sub AS (
  SELECT cs.id AS subscription_id
  FROM public.company_subscriptions cs
  WHERE cs.company_id = 'a8f52d3f-c189-4df2-9690-b34a26d2e114'::uuid
  LIMIT 1
),
addons AS (
  SELECT id, code
  FROM public.billing_addons
  WHERE code IN ('extra_seat', 'crm_integration')
)
INSERT INTO public.company_subscription_addons (subscription_id, addon_id, quantity)
SELECT
  sub.subscription_id,
  addons.id,
  CASE WHEN addons.code = 'extra_seat' THEN 2 ELSE 1 END
FROM sub
JOIN addons ON true
ON CONFLICT (subscription_id, addon_id)
DO UPDATE SET quantity = EXCLUDED.quantity;

COMMIT;
