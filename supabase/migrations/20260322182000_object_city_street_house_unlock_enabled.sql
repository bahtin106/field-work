begin;

update public.entity_field_catalog
set
  locked_enabled = false,
  updated_at = now()
where entity_type = 'object'
  and field_key in ('city', 'street', 'house');

commit;
