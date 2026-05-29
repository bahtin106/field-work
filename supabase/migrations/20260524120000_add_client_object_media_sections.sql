alter table public.client_objects
  add column if not exists media_sections text[] null;

alter table public.client_objects
  drop constraint if exists client_objects_media_sections_allowed;

alter table public.client_objects
  add constraint client_objects_media_sections_allowed
  check (
    media_sections is null
    or media_sections <@ array['media_file_1', 'media_file_2', 'media_file_3']::text[]
  );

comment on column public.client_objects.media_sections is
  'Explicit per-object visible media section keys. NULL keeps legacy visibility derived from field settings and existing photos; an empty array means all media sections are hidden for this object.';

update public.client_objects
set
  media_sections = array_remove(array[
    case when media_file_1_label is distinct from '__object_media_section_hidden__' then 'media_file_1' end,
    case when media_file_2_label is distinct from '__object_media_section_hidden__' then 'media_file_2' end,
    case when media_file_3_label is distinct from '__object_media_section_hidden__' then 'media_file_3' end
  ]::text[], null),
  media_file_1_label = nullif(media_file_1_label, '__object_media_section_hidden__'),
  media_file_2_label = nullif(media_file_2_label, '__object_media_section_hidden__'),
  media_file_3_label = nullif(media_file_3_label, '__object_media_section_hidden__')
where media_file_1_label = '__object_media_section_hidden__'
   or media_file_2_label = '__object_media_section_hidden__'
   or media_file_3_label = '__object_media_section_hidden__';
