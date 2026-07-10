begin;

alter function public.clients_prevent_primary_phone_duplicates()
  security definer
  set search_path = pg_catalog, public, auth, storage, extensions;

revoke all on function public.clients_prevent_primary_phone_duplicates()
  from public, anon, authenticated;

commit;
