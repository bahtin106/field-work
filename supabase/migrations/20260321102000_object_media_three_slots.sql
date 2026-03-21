begin;

alter table public.client_objects
  add column if not exists media_file_1 text[] not null default '{}'::text[],
  add column if not exists media_file_2 text[] not null default '{}'::text[],
  add column if not exists media_file_3 text[] not null default '{}'::text[];

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
  ('object', 'media_file_1', 'object_media_field_1', 'media', 'media', 200, true, true, false, false, false, true),
  ('object', 'media_file_2', 'object_media_field_2', 'media', 'media', 210, true, true, false, false, false, true),
  ('object', 'media_file_3', 'object_media_field_3', 'media', 'media', 220, true, true, false, false, false, true)
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

commit;
