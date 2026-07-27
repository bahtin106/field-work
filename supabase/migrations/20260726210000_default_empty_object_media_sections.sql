begin;

alter table public.client_objects
  alter column media_sections set default '{}'::text[];

comment on column public.client_objects.media_sections is
  'Explicit per-object visible media section keys. New objects default to an empty array and receive media sections only when a user adds them manually. Existing NULL rows retain legacy visibility derived from field settings and uploaded photos.';

commit;
