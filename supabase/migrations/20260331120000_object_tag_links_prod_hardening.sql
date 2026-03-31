begin;

-- 1) Defense-in-depth grants.
revoke all on table public.object_tag_links from anon;
revoke all on table public.object_tag_links from authenticated;
revoke all on table public.object_tag_links from service_role;

grant select, insert, update, delete on table public.object_tag_links to authenticated;
grant select, insert, update, delete on table public.object_tag_links to service_role;

drop policy if exists object_tag_links_service_role_all on public.object_tag_links;
create policy object_tag_links_service_role_all
on public.object_tag_links
for all
to service_role
using (true)
with check (true);

-- 2) Optional actor FK for audit trail navigation/integrity.
alter table public.object_tag_links
  drop constraint if exists object_tag_links_created_by_fkey,
  add constraint object_tag_links_created_by_fkey
    foreign key (created_by)
    references public.profiles(id)
    on delete set null;

commit;
