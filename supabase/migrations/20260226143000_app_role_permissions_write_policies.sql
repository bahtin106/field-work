-- Fix RLS for app_role_permissions writes from company access settings screen.
-- The table previously had only SELECT policy, so UPSERT failed with:
-- "new row violates row-level security policy for table app_role_permissions".

alter table if exists public.app_role_permissions enable row level security;

drop policy if exists app_role_permissions_insert_admin_only on public.app_role_permissions;
create policy app_role_permissions_insert_admin_only
on public.app_role_permissions
for insert
to authenticated
with check (is_admin() and company_id = user_company_id());

drop policy if exists app_role_permissions_update_admin_only on public.app_role_permissions;
create policy app_role_permissions_update_admin_only
on public.app_role_permissions
for update
to authenticated
using (is_admin() and company_id = user_company_id())
with check (is_admin() and company_id = user_company_id());

drop policy if exists app_role_permissions_delete_admin_only on public.app_role_permissions;
create policy app_role_permissions_delete_admin_only
on public.app_role_permissions
for delete
to authenticated
using (is_admin() and company_id = user_company_id());

