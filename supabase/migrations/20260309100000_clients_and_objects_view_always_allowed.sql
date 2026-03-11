create or replace function public.clients_permission_default(p_role text, p_key text)
returns boolean
language sql
immutable
as $$
  select case
    when p_key = 'canViewClients' then true
    when lower(coalesce(p_role, '')) in ('admin', 'dispatcher') then true
    when lower(coalesce(p_role, '')) = 'worker' then p_key in ('canCreateClients')
    else false
  end;
$$;

create or replace function public.object_permission_default(p_role text, p_key text)
returns boolean
language sql
immutable
as $$
  select case
    when p_key = 'canViewObjects' then true
    when lower(coalesce(p_role, '')) in ('admin', 'dispatcher') then true
    when lower(coalesce(p_role, '')) = 'worker' then p_key in ('canCreateObjects')
    else false
  end;
$$;

delete from public.app_role_permissions
where key in ('canViewClients', 'canViewObjects');

drop policy if exists clients_select_company on public.clients;
create policy clients_select_company
on public.clients
for select
to authenticated
using (
  company_id = user_company_id()
);

drop policy if exists client_objects_select_company on public.client_objects;
create policy client_objects_select_company
on public.client_objects
for select
to authenticated
using (
  company_id = user_company_id()
);

drop policy if exists object_tag_links_select_company on public.object_tag_links;
create policy object_tag_links_select_company
on public.object_tag_links
for select
to authenticated
using (
  company_id = user_company_id()
);
