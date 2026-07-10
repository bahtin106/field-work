begin;

update public.entity_field_catalog
set default_required = false
where entity_type = 'order'
  and field_key = 'time_window_start';

update public.entity_field_catalog
set default_enabled = false
where (entity_type, field_key) in (
  ('order', 'urgent'),
  ('object', 'country'),
  ('object', 'region'),
  ('object', 'postal_code'),
  ('object', 'floor'),
  ('object', 'entrance'),
  ('object', 'comment'),
  ('object', 'additional_phone_1'),
  ('object', 'additional_phone_2'),
  ('object', 'additional_phone_3'),
  ('object', 'media_file_1'),
  ('object', 'media_file_2'),
  ('object', 'media_file_3'),
  ('client', 'comment'),
  ('client', 'email'),
  ('employee', 'birthdate')
);

commit;
