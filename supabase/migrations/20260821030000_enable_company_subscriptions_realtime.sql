begin;

-- Subscription access is calculated from company_subscriptions. Publishing the
-- table lets authenticated company members receive their RLS-filtered changes
-- without waiting for the local entitlement cache to become stale.
do $$
begin
  if to_regclass('public.company_subscriptions') is null then
    raise exception 'public.company_subscriptions does not exist';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'company_subscriptions'
  ) then
    alter publication supabase_realtime add table public.company_subscriptions;
  end if;
end;
$$;

commit;
