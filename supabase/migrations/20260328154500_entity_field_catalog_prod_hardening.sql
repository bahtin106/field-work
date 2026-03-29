begin;

-- 1) Defense-in-depth grants: catalog is read-only for authenticated clients.
revoke all on table public.entity_field_catalog from anon;
revoke all on table public.entity_field_catalog from authenticated;

grant select on table public.entity_field_catalog to authenticated;
grant select on table public.entity_field_catalog to service_role;

-- 2) Integrity constraints for stable catalog metadata.
alter table public.entity_field_catalog
  drop constraint if exists entity_field_catalog_field_key_nonempty_check,
  drop constraint if exists entity_field_catalog_label_key_nonempty_check,
  drop constraint if exists entity_field_catalog_section_key_nonempty_check,
  drop constraint if exists entity_field_catalog_input_kind_nonempty_check,
  drop constraint if exists entity_field_catalog_sort_order_nonnegative_check,
  drop constraint if exists entity_field_catalog_locked_required_implies_enabled_check,
  drop constraint if exists entity_field_catalog_default_required_valid_check;

alter table public.entity_field_catalog
  add constraint entity_field_catalog_field_key_nonempty_check
    check (btrim(field_key) <> ''),
  add constraint entity_field_catalog_label_key_nonempty_check
    check (btrim(label_key) <> ''),
  add constraint entity_field_catalog_section_key_nonempty_check
    check (btrim(section_key) <> ''),
  add constraint entity_field_catalog_input_kind_nonempty_check
    check (btrim(input_kind) <> ''),
  add constraint entity_field_catalog_sort_order_nonnegative_check
    check (sort_order >= 0),
  add constraint entity_field_catalog_locked_required_implies_enabled_check
    check ((not locked_required) or locked_enabled),
  add constraint entity_field_catalog_default_required_valid_check
    check ((not default_required) or supports_required or locked_required);

-- 3) Read-path index for get_company_entity_field_settings ordering/filter.
create index if not exists entity_field_catalog_read_idx
  on public.entity_field_catalog (entity_type, is_active, sort_order, field_key);

commit;