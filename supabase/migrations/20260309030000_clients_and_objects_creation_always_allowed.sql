create or replace function public.clients_permission_default(p_role text, p_key text)
returns boolean
language sql
immutable
as $$
  select case
    when lower(coalesce(p_role, '')) in ('admin', 'dispatcher') then true
    when lower(coalesce(p_role, '')) = 'worker' then p_key in ('canViewClients', 'canCreateClients')
    else false
  end;
$$;

create or replace function public.object_permission_default(p_role text, p_key text)
returns boolean
language sql
immutable
as $$
  select case
    when lower(coalesce(p_role, '')) in ('admin', 'dispatcher') then true
    when lower(coalesce(p_role, '')) = 'worker' then p_key in ('canViewObjects', 'canCreateObjects')
    else false
  end;
$$;

delete from public.app_role_permissions
where key in ('canCreateClients', 'canCreateObjects');

drop policy if exists clients_insert_company on public.clients;
create policy clients_insert_company
on public.clients
for insert
to authenticated
with check (
  company_id = user_company_id()
);

drop policy if exists client_objects_insert_company on public.client_objects;
create policy client_objects_insert_company
on public.client_objects
for insert
to authenticated
with check (
  company_id = user_company_id()
);
