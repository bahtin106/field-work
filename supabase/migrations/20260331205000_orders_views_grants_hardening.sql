begin;

-- Tighten view grants: no anonymous/public access.
revoke all on table public.orders_read_masked from public, anon, authenticated, service_role;
revoke all on table public.orders_secure from public, anon, authenticated, service_role;
revoke all on table public.orders_secure_v2 from public, anon, authenticated, service_role;

grant select on table public.orders_read_masked to authenticated, service_role;
grant select on table public.orders_secure to authenticated, service_role;
grant select on table public.orders_secure_v2 to authenticated, service_role;

-- Tighten RPC grants consistently.
revoke all on function public.search_orders(text, uuid, text, text[], boolean, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.search_orders(text, uuid, text, text[], boolean, integer, integer) to authenticated, service_role;

commit;
