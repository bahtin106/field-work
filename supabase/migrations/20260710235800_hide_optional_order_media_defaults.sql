begin;

-- Additional order media sections are opt-in for newly created company field
-- settings. Existing per-company choices remain unchanged.
update public.entity_field_catalog
set default_enabled = false
where entity_type = 'order'
  and field_key in ('media_file_2', 'media_file_3', 'media_file_4', 'media_file_5');

commit;
