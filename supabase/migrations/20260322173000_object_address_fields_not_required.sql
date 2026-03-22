begin;

update public.entity_field_catalog
set
  default_required = false,
  locked_required = false,
  updated_at = now()
where entity_type = 'object'
  and field_key in ('city', 'street', 'house');

update public.company_entity_field_settings
set
  is_required = false,
  updated_at = now()
where entity_type = 'object'
  and field_key in ('city', 'street', 'house')
  and is_required = true;

commit;
