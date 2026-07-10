begin;

-- Department visibility is controlled by the company departments feature, not
-- by the independent employee field editor. Deleting the catalog row also
-- removes its obsolete per-company settings through the foreign key cascade.
delete from public.entity_field_catalog
where entity_type = 'employee'
  and field_key = 'department_id';

-- Objects currently support three media sections. Keep the optional sections
-- hidden for newly created company field settings.
update public.entity_field_catalog
set default_enabled = false
where entity_type = 'object'
  and field_key in ('media_file_2', 'media_file_3');

commit;
