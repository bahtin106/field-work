begin;

revoke all on table public.company_tags from authenticated;
revoke all on table public.company_tags from service_role;

grant select, insert, update, delete on table public.company_tags to authenticated;
grant select, insert, update, delete on table public.company_tags to service_role;

commit;
