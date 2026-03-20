begin;

-- Remove deprecated order contact fields from field-settings backend and clear test values.
update public.entity_field_catalog
set is_active = false,
    updated_at = now()
where entity_type = 'order'
  and field_key in ('secondary_phone', 'contact_email');

delete from public.company_entity_field_settings
where entity_type = 'order'
  and field_key in ('secondary_phone', 'contact_email');

do $$
declare
  has_secondary_phone boolean;
  has_contact_email boolean;
begin
  select exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'orders'
       and column_name = 'secondary_phone'
  ) into has_secondary_phone;

  select exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'orders'
       and column_name = 'contact_email'
  ) into has_contact_email;

  if has_secondary_phone and has_contact_email then
    execute $sql$
      update public.orders
         set secondary_phone = null,
             contact_email = null
       where nullif(btrim(coalesce(secondary_phone, '')), '') is not null
          or nullif(btrim(coalesce(contact_email, '')), '') is not null
    $sql$;
  elsif has_secondary_phone then
    execute $sql$
      update public.orders
         set secondary_phone = null
       where nullif(btrim(coalesce(secondary_phone, '')), '') is not null
    $sql$;
  elsif has_contact_email then
    execute $sql$
      update public.orders
         set contact_email = null
       where nullif(btrim(coalesce(contact_email, '')), '') is not null
    $sql$;
  end if;
end
$$;

-- Add / upsert new order field-settings entries.
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
  ('order', 'departure_time', 'order_field_departure_time', 'scheduling', 'time', 101, true, true, false, false, false, true),
  ('order', 'payment_status', 'order_field_payment_status', 'finance', 'select', 140, true, true, false, false, false, true),
  ('order', 'payment_method', 'order_field_payment_method', 'finance', 'select', 150, true, true, false, false, false, true),
  ('order', 'contract_file', 'order_details_contract_photo', 'media', 'media', 160, true, true, false, false, false, true),
  ('order', 'photo_before', 'order_details_photo_before', 'media', 'media', 170, true, true, false, false, false, true),
  ('order', 'photo_after', 'order_details_photo_after', 'media', 'media', 180, true, true, false, false, false, true),
  ('order', 'act_file', 'order_details_act', 'media', 'media', 190, true, true, false, false, false, true)
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

-- Rename price field label in backend catalog.
update public.entity_field_catalog
set label_key = 'order_field_initial_amount',
    supports_required = true,
    locked_required = false,
    updated_at = now()
where entity_type = 'order'
  and field_key = 'price';

-- Ensure required toggle support for target order fields.
update public.entity_field_catalog
set supports_required = true,
    locked_required = false,
    updated_at = now()
where entity_type = 'order'
  and field_key in (
    'departure_time',
    'payment_status',
    'payment_method',
    'contract_file',
    'photo_before',
    'photo_after',
    'act_file'
  );

update public.entity_field_catalog
set locked_required = false,
    supports_required = true,
    updated_at = now()
where entity_type = 'order'
  and field_key in ('title', 'time_window_start');

-- Remove deprecated duplicate company-level toggle.
alter table public.companies
  drop column if exists use_departure_time;

commit;
