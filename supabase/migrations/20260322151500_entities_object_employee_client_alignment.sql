begin;

alter table public.profiles
  add column if not exists middle_name text;

update public.profiles
set middle_name = nullif(btrim(coalesce(middle_name, '')), '');

create or replace function public.sync_profiles_full_name()
returns trigger
language plpgsql
as $$
declare
  combined text;
begin
  if tg_op = 'INSERT'
     or new.first_name is distinct from old.first_name
     or new.middle_name is distinct from old.middle_name
     or new.last_name is distinct from old.last_name then
    combined := nullif(trim(concat_ws(' ', new.first_name, new.middle_name, new.last_name)), '');
    new.full_name := combined;
  end if;
  return new;
end;
$$;

update public.profiles
set full_name = nullif(trim(concat_ws(' ', first_name, middle_name, last_name)), '')
where first_name is not null
   or middle_name is not null
   or last_name is not null;

alter table public.client_objects
  add column if not exists comment text;

-- migrate and clean legacy data before dropping columns
update public.client_objects
set apartment = coalesce(nullif(btrim(apartment), ''), nullif(btrim(office), '')),
    comment = coalesce(nullif(btrim(comment), ''), nullif(btrim(entrance_info), '')),
    office = null,
    parking_notes = null
where true;

alter table public.client_objects
  drop column if exists office,
  drop column if exists parking_notes;

create or replace function public.client_objects_sync_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select c.company_id
    into v_company_id
    from public.clients c
   where c.id = new.client_id;

  if v_company_id is null then
    raise exception 'client % not found for object', new.client_id using errcode = '23503';
  end if;

  new.company_id := v_company_id;
  new.name := coalesce(nullif(btrim(coalesce(new.name, '')), ''), 'Новый объект');
  new.country := nullif(btrim(coalesce(new.country, '')), '');
  new.region := nullif(btrim(coalesce(new.region, '')), '');
  new.district := nullif(btrim(coalesce(new.district, '')), '');
  new.city := nullif(btrim(coalesce(new.city, '')), '');
  new.street := nullif(btrim(coalesce(new.street, '')), '');
  new.house := nullif(btrim(coalesce(new.house, '')), '');
  new.postal_code := nullif(btrim(coalesce(new.postal_code, '')), '');
  new.floor := nullif(btrim(coalesce(new.floor, '')), '');
  new.entrance := nullif(btrim(coalesce(new.entrance, '')), '');
  new.apartment := nullif(btrim(coalesce(new.apartment, '')), '');
  new.comment := coalesce(
    nullif(btrim(coalesce(new.comment, '')), ''),
    nullif(btrim(coalesce(new.entrance_info, '')), '')
  );
  -- keep compatibility with legacy orders address field key
  new.entrance_info := new.comment;
  new.geo_lat := nullif(btrim(coalesce(new.geo_lat, '')), '');
  new.geo_lng := nullif(btrim(coalesce(new.geo_lng, '')), '');
  new.additional_phone_1 := nullif(btrim(coalesce(new.additional_phone_1, '')), '');
  new.additional_phone_1_label := nullif(left(btrim(coalesce(new.additional_phone_1_label, '')), 48), '');
  new.additional_phone_2 := nullif(btrim(coalesce(new.additional_phone_2, '')), '');
  new.additional_phone_2_label := nullif(left(btrim(coalesce(new.additional_phone_2_label, '')), 48), '');
  new.additional_phone_3 := nullif(btrim(coalesce(new.additional_phone_3, '')), '');
  new.additional_phone_3_label := nullif(left(btrim(coalesce(new.additional_phone_3_label, '')), 48), '');

  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, timezone('utc'::text, now()));
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;

  new.updated_at := timezone('utc'::text, now());
  new.updated_by := auth.uid();

  if coalesce(new.is_primary, false) then
    if exists (
      select 1
        from public.client_objects o
       where o.client_id = new.client_id
         and o.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(o.is_primary, false)
    ) then
      update public.client_objects
         set is_primary = false,
             updated_at = timezone('utc'::text, now()),
             updated_by = auth.uid()
       where client_id = new.client_id
         and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(is_primary, false);
    end if;
  end if;

  return new;
end
$$;

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
  ('object', 'comment', 'order_field_comment', 'additional', 'multiline', 120, true, true, false, false, false, true),
  ('employee', 'middle_name', 'label_middle_name', 'personal', 'text', 40, false, true, false, true, false, true)
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

update public.entity_field_catalog
set
  label_key = 'order_field_apartment',
  sort_order = 110,
  updated_at = now()
where entity_type = 'object'
  and field_key = 'apartment';

update public.entity_field_catalog
set
  sort_order = case field_key
    when 'floor' then 90
    when 'entrance' then 100
    else sort_order
  end,
  updated_at = now()
where entity_type = 'object'
  and field_key in ('floor', 'entrance');

update public.entity_field_catalog
set
  is_active = false,
  updated_at = now()
where entity_type = 'object'
  and field_key in ('office', 'entrance_info', 'parking_notes');

update public.entity_field_catalog
set
  supports_required = false,
  default_required = false,
  locked_enabled = true,
  locked_required = false,
  updated_at = now()
where entity_type in ('employee', 'client')
  and field_key in ('first_name', 'last_name', 'middle_name');

update public.entity_field_catalog
set
  label_key = 'view_label_email',
  updated_at = now()
where entity_type in ('employee', 'client')
  and field_key = 'email';

with source_settings as (
  select
    company_id,
    entity_type,
    bool_or(is_enabled) filter (where field_key = 'apartment') as apartment_enabled,
    bool_or(is_required) filter (where field_key = 'apartment') as apartment_required,
    bool_or(is_enabled) filter (where field_key = 'office') as office_enabled,
    bool_or(is_required) filter (where field_key = 'office') as office_required,
    bool_or(is_enabled) filter (where field_key = 'comment') as comment_enabled,
    bool_or(is_required) filter (where field_key = 'comment') as comment_required,
    bool_or(is_enabled) filter (where field_key = 'entrance_info') as entrance_info_enabled,
    bool_or(is_required) filter (where field_key = 'entrance_info') as entrance_info_required
  from public.company_entity_field_settings
  where entity_type = 'object'
  group by company_id, entity_type
)
insert into public.company_entity_field_settings (
  company_id,
  entity_type,
  field_key,
  is_enabled,
  is_required
)
select
  s.company_id,
  'object',
  'comment',
  coalesce(s.comment_enabled, s.entrance_info_enabled, true),
  coalesce(s.comment_required, s.entrance_info_required, false)
from source_settings s
on conflict (company_id, entity_type, field_key) do update
set
  is_enabled = excluded.is_enabled,
  is_required = excluded.is_required,
  updated_at = now();

with source_settings as (
  select
    company_id,
    bool_or(is_enabled) filter (where field_key = 'apartment') as apartment_enabled,
    bool_or(is_required) filter (where field_key = 'apartment') as apartment_required,
    bool_or(is_enabled) filter (where field_key = 'office') as office_enabled,
    bool_or(is_required) filter (where field_key = 'office') as office_required
  from public.company_entity_field_settings
  where entity_type = 'object'
  group by company_id
)
insert into public.company_entity_field_settings (
  company_id,
  entity_type,
  field_key,
  is_enabled,
  is_required
)
select
  s.company_id,
  'object',
  'apartment',
  coalesce(s.apartment_enabled, s.office_enabled, true),
  coalesce(s.apartment_required, s.office_required, false)
from source_settings s
on conflict (company_id, entity_type, field_key) do update
set
  is_enabled = excluded.is_enabled,
  is_required = excluded.is_required,
  updated_at = now();

delete from public.company_entity_field_settings
where entity_type = 'object'
  and field_key in ('office', 'entrance_info', 'parking_notes');

commit;
