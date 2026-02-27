-- Add media-related access permission rows for companies that already use app_role_permissions.
-- Safe to run multiple times: only inserts missing (company_id, role, key) combinations.

with companies_with_access_settings as (
  select distinct company_id
  from public.app_role_permissions
),
role_permission_defaults as (
  select *
  from (
    values
      ('admin'::text, 'canAddGalleryPhotos'::text, true),
      ('admin'::text, 'canAddCameraPhotos'::text, true),
      ('admin'::text, 'canViewOrderPhotos'::text, true),
      ('admin'::text, 'canViewOrderAmount'::text, true),
      ('admin'::text, 'canEditOrderAmount'::text, true),
      ('admin'::text, 'canViewOrderFuelCost'::text, true),
      ('admin'::text, 'canEditOrderFuelCost'::text, true),
      ('dispatcher'::text, 'canAddGalleryPhotos'::text, true),
      ('dispatcher'::text, 'canAddCameraPhotos'::text, true),
      ('dispatcher'::text, 'canViewOrderPhotos'::text, true),
      ('dispatcher'::text, 'canViewOrderAmount'::text, true),
      ('dispatcher'::text, 'canEditOrderAmount'::text, true),
      ('dispatcher'::text, 'canViewOrderFuelCost'::text, true),
      ('dispatcher'::text, 'canEditOrderFuelCost'::text, true),
      ('worker'::text, 'canAddGalleryPhotos'::text, false),
      ('worker'::text, 'canAddCameraPhotos'::text, true),
      ('worker'::text, 'canViewOrderPhotos'::text, true),
      ('worker'::text, 'canViewOrderAmount'::text, true),
      ('worker'::text, 'canEditOrderAmount'::text, false),
      ('worker'::text, 'canViewOrderFuelCost'::text, true),
      ('worker'::text, 'canEditOrderFuelCost'::text, false)
  ) as t(role, key, value)
)
insert into public.app_role_permissions (company_id, role, key, value)
select c.company_id, d.role, d.key, d.value
from companies_with_access_settings c
cross join role_permission_defaults d
where not exists (
  select 1
  from public.app_role_permissions p
  where p.company_id = c.company_id
    and p.role = d.role
    and p.key = d.key
)
on conflict (company_id, role, key) do nothing;
