begin;

alter table public.company_storage_usage_cache
  drop constraint if exists company_storage_usage_cache_non_negative_check;

alter table public.company_storage_usage_cache
  add constraint company_storage_usage_cache_non_negative_check
  check (
    limit_bytes >= 0
    and data_bytes >= 0
    and media_bytes >= 0
    and media_orders_bytes >= 0
    and media_avatars_bytes >= 0
    and total_bytes >= 0
  );

alter table public.company_storage_usage_cache
  drop constraint if exists company_storage_usage_cache_total_consistency_check;

alter table public.company_storage_usage_cache
  add constraint company_storage_usage_cache_total_consistency_check
  check (total_bytes = data_bytes + media_bytes);

alter table public.company_storage_usage_cache
  drop constraint if exists company_storage_usage_cache_breakdown_object_check;

alter table public.company_storage_usage_cache
  add constraint company_storage_usage_cache_breakdown_object_check
  check (jsonb_typeof(data_tables_breakdown) = 'object');

commit;

