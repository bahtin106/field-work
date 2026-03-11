drop policy if exists clients_select_company on public.clients;
create policy clients_select_company
on public.clients
for select
to authenticated
using (
  company_id = user_company_id()
  and (
    has_app_role_permission(
      company_id,
      user_role(),
      'canViewClients',
      clients_permission_default(user_role(), 'canViewClients')
    )
    or has_app_role_permission(
      company_id,
      user_role(),
      'canCreateOrders',
      false
    )
    or has_app_role_permission(
      company_id,
      user_role(),
      'canEditOrders',
      false
    )
  )
);

drop policy if exists client_objects_select_company on public.client_objects;
create policy client_objects_select_company
on public.client_objects
for select
to authenticated
using (
  company_id = user_company_id()
  and (
    has_app_role_permission(
      company_id,
      user_role(),
      'canViewObjects',
      object_permission_default(user_role(), 'canViewObjects')
    )
    or has_app_role_permission(
      company_id,
      user_role(),
      'canCreateOrders',
      false
    )
    or has_app_role_permission(
      company_id,
      user_role(),
      'canEditOrders',
      false
    )
  )
);

drop policy if exists object_tag_links_select_company on public.object_tag_links;
create policy object_tag_links_select_company
on public.object_tag_links
for select
to authenticated
using (
  company_id = user_company_id()
  and (
    has_app_role_permission(
      company_id,
      user_role(),
      'canViewObjects',
      object_permission_default(user_role(), 'canViewObjects')
    )
    or has_app_role_permission(
      company_id,
      user_role(),
      'canCreateOrders',
      false
    )
    or has_app_role_permission(
      company_id,
      user_role(),
      'canEditOrders',
      false
    )
  )
);
