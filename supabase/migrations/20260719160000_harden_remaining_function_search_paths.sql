begin;

-- These helpers only use arguments, built-in pg_catalog routines and explicitly
-- qualified public objects. Pinning an empty search_path removes caller-controlled
-- name resolution without changing their signatures, ownership or privileges.
alter function public.media_assets_provider_from_url(text, text)
  set search_path = '';

alter function public.media_assets_storage_bucket_from_url(text)
  set search_path = '';

alter function public.finance_validate_rule_conditions(jsonb)
  set search_path = '';

alter function public.finance_rule_conditions_match(jsonb, public.orders)
  set search_path = '';

commit;
