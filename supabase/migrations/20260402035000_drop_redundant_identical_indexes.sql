set search_path = public;

alter table public.app_role_permissions
  drop constraint if exists app_role_permissions_company_role_key_uk;

drop index if exists public.client_objects_primary_unique_idx;
