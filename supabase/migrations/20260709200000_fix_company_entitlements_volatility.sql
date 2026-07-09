-- get_company_entitlements reads billing state for the app, but it also
-- normalizes/creates the subscription row through ensure_company_subscription.
-- Mark it volatile so PostgREST does not run the RPC in a read-only transaction.
do $$
begin
  if to_regprocedure('public.get_company_entitlements(uuid)') is not null then
    execute 'alter function public.get_company_entitlements(uuid) volatile';
  end if;
end;
$$;

notify pgrst, 'reload schema';
