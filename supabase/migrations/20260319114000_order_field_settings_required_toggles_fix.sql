begin;

update public.entity_field_catalog
set
  locked_required = false,
  supports_required = true,
  updated_at = now()
where entity_type = 'order'
  and field_key in ('title', 'time_window_start');

update public.entity_field_catalog
set
  supports_required = true,
  updated_at = now()
where entity_type = 'order'
  and field_key in (
    'assigned_to',
    'department_id',
    'price',
    'payment_status',
    'payment_method'
  );

commit;
