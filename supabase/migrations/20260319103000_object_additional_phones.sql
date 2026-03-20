begin;

alter table public.client_objects
  add column if not exists additional_phone_1 text,
  add column if not exists additional_phone_1_label text,
  add column if not exists additional_phone_2 text,
  add column if not exists additional_phone_2_label text,
  add column if not exists additional_phone_3 text,
  add column if not exists additional_phone_3_label text;

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
  new.office := nullif(btrim(coalesce(new.office, '')), '');
  new.floor := nullif(btrim(coalesce(new.floor, '')), '');
  new.entrance := nullif(btrim(coalesce(new.entrance, '')), '');
  new.apartment := nullif(btrim(coalesce(new.apartment, '')), '');
  new.entrance_info := nullif(btrim(coalesce(new.entrance_info, '')), '');
  new.parking_notes := nullif(btrim(coalesce(new.parking_notes, '')), '');
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

update public.client_objects
set additional_phone_1 = nullif(btrim(coalesce(additional_phone_1, '')), ''),
    additional_phone_1_label = nullif(left(btrim(coalesce(additional_phone_1_label, '')), 48), ''),
    additional_phone_2 = nullif(btrim(coalesce(additional_phone_2, '')), ''),
    additional_phone_2_label = nullif(left(btrim(coalesce(additional_phone_2_label, '')), 48), ''),
    additional_phone_3 = nullif(btrim(coalesce(additional_phone_3, '')), ''),
    additional_phone_3_label = nullif(left(btrim(coalesce(additional_phone_3_label, '')), 48), '');

alter table public.client_objects
  drop constraint if exists client_objects_additional_phone_1_label_len_check,
  drop constraint if exists client_objects_additional_phone_2_label_len_check,
  drop constraint if exists client_objects_additional_phone_3_label_len_check;

alter table public.client_objects
  add constraint client_objects_additional_phone_1_label_len_check
    check (additional_phone_1_label is null or char_length(additional_phone_1_label) <= 48),
  add constraint client_objects_additional_phone_2_label_len_check
    check (additional_phone_2_label is null or char_length(additional_phone_2_label) <= 48),
  add constraint client_objects_additional_phone_3_label_len_check
    check (additional_phone_3_label is null or char_length(additional_phone_3_label) <= 48);

create index if not exists client_objects_company_additional_phone_1_idx
  on public.client_objects(company_id, additional_phone_1)
  where additional_phone_1 is not null;
create index if not exists client_objects_company_additional_phone_2_idx
  on public.client_objects(company_id, additional_phone_2)
  where additional_phone_2 is not null;
create index if not exists client_objects_company_additional_phone_3_idx
  on public.client_objects(company_id, additional_phone_3)
  where additional_phone_3 is not null;

comment on column public.client_objects.additional_phone_1 is
  'Additional object phone slot #1.';
comment on column public.client_objects.additional_phone_1_label is
  'Optional label for additional object phone slot #1.';
comment on column public.client_objects.additional_phone_2 is
  'Additional object phone slot #2.';
comment on column public.client_objects.additional_phone_2_label is
  'Optional label for additional object phone slot #2.';
comment on column public.client_objects.additional_phone_3 is
  'Additional object phone slot #3.';
comment on column public.client_objects.additional_phone_3_label is
  'Optional label for additional object phone slot #3.';

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
  ('object', 'additional_phone_1', 'order_field_secondary_phone', 'contact', 'phone', 170, true, true, false, false, false, true),
  ('object', 'additional_phone_2', 'client_field_additional_phone_2', 'contact', 'phone', 180, true, true, false, false, false, true),
  ('object', 'additional_phone_3', 'client_field_additional_phone_3', 'contact', 'phone', 190, true, true, false, false, false, true)
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
