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
  ('order', 'payment_status', 'order_field_payment_status', 'finance', 'select', 140, false, true, false, false, false, true),
  ('order', 'payment_method', 'order_field_payment_method', 'finance', 'select', 150, false, true, false, false, false, true)
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

update public.entity_field_catalog
set
  locked_enabled = false,
  locked_required = false,
  supports_required = true,
  default_enabled = true,
  default_required = true,
  updated_at = now()
where entity_type = 'order'
  and field_key = 'time_window_start';

commit;
