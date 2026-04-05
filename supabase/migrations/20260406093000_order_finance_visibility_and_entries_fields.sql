begin;

insert into public.entity_field_catalog (
  entity_type,
  field_key,
  label_key,
  section_key,
  input_kind,
  sort_order,
  supports_required,
  default_enabled,
  default_required,
  locked_enabled,
  locked_required,
  is_active
)
values
  ('order', 'finance', 'order_field_finance', 'finance', 'boolean', 120, false, true, false, false, false, true),
  ('order', 'finance_entries', 'order_field_finance_entries', 'finance', 'boolean', 121, false, true, false, false, false, true)
on conflict (entity_type, field_key) do update
set
  label_key = excluded.label_key,
  section_key = excluded.section_key,
  input_kind = excluded.input_kind,
  sort_order = excluded.sort_order,
  supports_required = excluded.supports_required,
  default_enabled = excluded.default_enabled,
  default_required = excluded.default_required,
  locked_enabled = excluded.locked_enabled,
  locked_required = excluded.locked_required,
  is_active = excluded.is_active,
  updated_at = now();

update public.company_entity_field_settings
set
  is_required = false,
  updated_at = now()
where entity_type = 'order'
  and field_key in ('finance', 'finance_entries')
  and is_required is distinct from false;

update public.company_entity_field_settings e
set
  is_enabled = false,
  is_required = false,
  updated_at = now()
from public.company_entity_field_settings f
where e.company_id = f.company_id
  and e.entity_type = 'order'
  and f.entity_type = 'order'
  and e.field_key = 'finance_entries'
  and f.field_key = 'finance'
  and coalesce(f.is_enabled, true) = false
  and coalesce(e.is_enabled, true) = true;

insert into public.company_entity_field_settings (
  company_id,
  entity_type,
  field_key,
  is_enabled,
  is_required
)
select
  e.company_id,
  'order',
  'finance',
  true,
  false
from public.company_entity_field_settings e
where e.entity_type = 'order'
  and e.field_key = 'finance_entries'
  and coalesce(e.is_enabled, true) = true
on conflict (company_id, entity_type, field_key) do update
set
  is_enabled = true,
  is_required = false,
  updated_at = now();

commit;
