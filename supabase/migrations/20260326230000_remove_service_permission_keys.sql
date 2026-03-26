-- Keep only UI-visible access keys in app_role_permissions (global cleanup).
-- This removes service/legacy keys and leaves strict 1:1 with Access Settings screen.

begin;

with ui_keys(key) as (
  values
    ('canCreateOrders'::text),
    ('canEditOrders'::text),
    ('canViewAllOrders'::text),
    ('canDeleteOrders'::text),
    ('canAddGalleryPhotos'::text),
    ('canAddCameraPhotos'::text),
    ('canViewFinanceAll'::text),
    ('canEditFinanceEntries'::text),
    ('canEditClients'::text),
    ('canDeleteClients'::text),
    ('canEditObjects'::text),
    ('canDeleteObjects'::text)
)
delete from public.app_role_permissions p
where not exists (
  select 1
  from ui_keys k
  where k.key = p.key
);

commit;
