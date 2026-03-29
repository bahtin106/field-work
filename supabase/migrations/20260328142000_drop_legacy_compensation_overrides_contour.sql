begin;

-- Remove legacy per-user payout override contour (superseded by company_finance_rules engine).

drop view if exists public.order_payouts;

drop function if exists public.get_order_payout(uuid);
drop function if exists public.calc_order_payout(uuid);
drop function if exists public.compute_payout(uuid);
drop function if exists public.list_user_comp_overrides();
drop function if exists public.upsert_user_comp_override(uuid, text, numeric, numeric, date, date, boolean);
drop function if exists public.upsert_payout_cache();

drop table if exists public.compensation_overrides;

commit;