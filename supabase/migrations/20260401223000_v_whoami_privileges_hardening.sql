begin;

revoke all on table public.v_whoami from anon;
revoke all on table public.v_whoami from public;
revoke all on table public.v_whoami from authenticated;

grant select on table public.v_whoami to authenticated;
grant select on table public.v_whoami to service_role;

commit;
