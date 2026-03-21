alter table public.client_objects
  add column if not exists location_mode text;

update public.client_objects
set location_mode = case
  when nullif(btrim(coalesce(geo_lat, '')), '') is not null
   and nullif(btrim(coalesce(geo_lng, '')), '') is not null
    then 'map'
  else 'address'
end
where location_mode is null
   or btrim(location_mode) = ''
   or location_mode not in ('address', 'map');

alter table public.client_objects
  alter column location_mode set default 'address';

alter table public.client_objects
  drop constraint if exists client_objects_location_mode_chk;

alter table public.client_objects
  add constraint client_objects_location_mode_chk
  check (location_mode in ('address', 'map'));

alter table public.client_objects
  alter column location_mode set not null;

comment on column public.client_objects.location_mode is
  'Источник отображения локации объекта: address (адрес) или map (координаты).';
