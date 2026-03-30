begin;

-- Legacy analytics artifacts: not used by current app codepath.
drop function if exists public.orders_daily_counts(date, date);
drop materialized view if exists public.mv_orders_daily_counts;

commit;
