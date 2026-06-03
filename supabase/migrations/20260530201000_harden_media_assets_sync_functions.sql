-- Media asset sync triggers read private media mapping tables and maintain the
-- derived public.media_assets catalog. They must run with the migration owner
-- privileges, otherwise ordinary authenticated users can hit "permission denied"
-- while creating or updating orders/objects/finance entries.

alter function public.media_assets_upsert(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  bigint,
  integer,
  text,
  jsonb
) security definer set search_path = public;

alter function public.media_assets_sync_order(uuid)
  security definer set search_path = public;

alter function public.media_assets_sync_object(uuid)
  security definer set search_path = public;

alter function public.media_assets_sync_finance_entry(uuid)
  security definer set search_path = public;

alter function public.media_assets_sync_order_trigger()
  security definer set search_path = public;

alter function public.media_assets_sync_object_trigger()
  security definer set search_path = public;

alter function public.media_assets_sync_finance_entry_trigger()
  security definer set search_path = public;

alter function public.media_assets_sync_order_map_trigger()
  security definer set search_path = public;

alter function public.media_assets_sync_object_map_trigger()
  security definer set search_path = public;

alter function public.media_assets_sync_finance_map_trigger()
  security definer set search_path = public;

alter function public.media_assets_sync_profile_map_trigger()
  security definer set search_path = public;

revoke execute on function public.media_assets_upsert(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  bigint,
  integer,
  text,
  jsonb
) from public, anon, authenticated;

revoke execute on function public.media_assets_sync_order(uuid) from public, anon, authenticated;
revoke execute on function public.media_assets_sync_object(uuid) from public, anon, authenticated;
revoke execute on function public.media_assets_sync_finance_entry(uuid) from public, anon, authenticated;
revoke execute on function public.media_assets_sync_order_trigger() from public, anon, authenticated;
revoke execute on function public.media_assets_sync_object_trigger() from public, anon, authenticated;
revoke execute on function public.media_assets_sync_finance_entry_trigger() from public, anon, authenticated;
revoke execute on function public.media_assets_sync_order_map_trigger() from public, anon, authenticated;
revoke execute on function public.media_assets_sync_object_map_trigger() from public, anon, authenticated;
revoke execute on function public.media_assets_sync_finance_map_trigger() from public, anon, authenticated;
revoke execute on function public.media_assets_sync_profile_map_trigger() from public, anon, authenticated;

grant execute on function public.media_assets_upsert(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  bigint,
  integer,
  text,
  jsonb
) to service_role;

grant execute on function public.media_assets_sync_order(uuid) to service_role;
grant execute on function public.media_assets_sync_object(uuid) to service_role;
grant execute on function public.media_assets_sync_finance_entry(uuid) to service_role;
