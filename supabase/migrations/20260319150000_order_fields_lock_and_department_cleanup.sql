begin;

-- Remove deprecated order "department" field from field-settings and clear test values.
update public.entity_field_catalog
set is_active = false,
    updated_at = now()
where entity_type = 'order'
  and field_key = 'department_id';

delete from public.company_entity_field_settings
where entity_type = 'order'
  and field_key = 'department_id';

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'orders'
       and column_name = 'department_id'
  ) then
    execute $sql$
      update public.orders
         set department_id = null
       where department_id is not null
    $sql$;
  end if;
end
$$;

-- Lock and enforce always-on required relation fields in orders.
update public.entity_field_catalog
set supports_required = false,
    default_enabled = true,
    default_required = true,
    locked_enabled = true,
    locked_required = true,
    is_active = true,
    updated_at = now()
where entity_type = 'order'
  and field_key in ('client_id', 'object_id', 'assigned_to');

-- Keep finance fields always visible and non-configurable in the field editor.
update public.entity_field_catalog
set supports_required = false,
    default_enabled = true,
    locked_enabled = true,
    locked_required = false,
    is_active = true,
    updated_at = now()
where entity_type = 'order'
  and field_key in ('price', 'payment_status', 'payment_method');

-- Remove stale per-company overrides for fixed order fields.
delete from public.company_entity_field_settings
where entity_type = 'order'
  and field_key in (
    'client_id',
    'object_id',
    'assigned_to',
    'price',
    'payment_status',
    'payment_method'
  );

commit;
