-- Keep app_role_permissions aligned with the active permission model.
-- Removes stale keys left from older access models.

begin;

with active_keys(key) as (
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
  from active_keys k
  where k.key = p.key
);

commit;
