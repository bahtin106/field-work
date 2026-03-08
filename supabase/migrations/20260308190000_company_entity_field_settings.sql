begin;

create table if not exists public.entity_field_catalog (
  entity_type text not null check (entity_type in ('order', 'object')),
  field_key text not null,
  label_key text not null,
  section_key text not null,
  input_kind text not null,
  sort_order integer not null,
  supports_required boolean not null default true,
  default_enabled boolean not null default true,
  default_required boolean not null default false,
  locked_enabled boolean not null default false,
  locked_required boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (entity_type, field_key)
);

create table if not exists public.company_entity_field_settings (
  company_id uuid not null references public.companies(id) on delete cascade,
  entity_type text not null check (entity_type in ('order', 'object')),
  field_key text not null,
  is_enabled boolean not null default true,
  is_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, entity_type, field_key),
  foreign key (entity_type, field_key)
    references public.entity_field_catalog(entity_type, field_key)
    on delete cascade
);

drop trigger if exists trg_entity_field_catalog_updated_at on public.entity_field_catalog;
create trigger trg_entity_field_catalog_updated_at
before update on public.entity_field_catalog
for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_company_entity_field_settings_updated_at on public.company_entity_field_settings;
create trigger trg_company_entity_field_settings_updated_at
before update on public.company_entity_field_settings
for each row execute function public.tg_set_updated_at();

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
  ('order', 'title', 'order_field_title', 'general', 'text', 10, true, true, true, true, true, true),
  ('order', 'comment', 'order_field_description', 'general', 'multiline', 20, true, true, false, false, false, true),
  ('order', 'work_type_id', 'order_field_work_type', 'general', 'select', 30, true, true, false, false, false, true),
  ('order', 'urgent', 'create_order_label_urgent', 'general', 'boolean', 40, false, true, false, false, false, true),
  ('order', 'client_id', 'order_details_customer', 'relations', 'relation', 50, false, true, true, true, true, true),
  ('order', 'object_id', 'routes_objects_object', 'relations', 'relation', 60, false, true, true, true, true, true),
  ('order', 'phone', 'order_details_phone', 'contact', 'phone', 70, true, true, true, true, true, true),
  ('order', 'secondary_phone', 'order_field_secondary_phone', 'contact', 'phone', 80, true, true, false, false, false, true),
  ('order', 'contact_email', 'order_field_contact_email', 'contact', 'email', 90, true, true, false, false, false, true),
  ('order', 'time_window_start', 'create_order_label_date', 'scheduling', 'datetime', 100, true, true, true, true, true, true),
  ('order', 'assigned_to', 'create_order_label_executor', 'scheduling', 'relation', 110, false, true, false, false, false, true),
  ('order', 'department_id', 'label_department', 'scheduling', 'select', 120, false, true, false, false, false, true),
  ('order', 'price', 'order_details_amount', 'finance', 'number', 130, false, true, false, false, false, true),
  ('order', 'fuel_cost', 'order_details_fuel', 'finance', 'number', 140, false, true, false, false, false, true),
  ('object', 'name', 'objects_field_name', 'general', 'text', 10, true, true, true, true, true, true),
  ('object', 'country', 'order_field_country', 'address', 'text', 20, true, true, false, false, false, true),
  ('object', 'region', 'order_field_region', 'address', 'text', 30, true, true, false, false, false, true),
  ('object', 'district', 'order_field_district', 'address', 'text', 40, true, true, false, false, false, true),
  ('object', 'city', 'order_field_city', 'address', 'text', 50, true, true, true, true, true, true),
  ('object', 'street', 'order_field_street', 'address', 'text', 60, true, true, true, true, true, true),
  ('object', 'house', 'order_field_house', 'address', 'text', 70, true, true, true, true, true, true),
  ('object', 'postal_code', 'order_field_postal_code', 'address', 'text', 80, true, true, false, false, false, true),
  ('object', 'office', 'order_field_office', 'address', 'text', 90, true, true, false, false, false, true),
  ('object', 'floor', 'order_field_floor', 'address', 'text', 100, true, true, false, false, false, true),
  ('object', 'entrance', 'order_field_entrance', 'address', 'text', 110, true, true, false, false, false, true),
  ('object', 'apartment', 'order_field_apartment', 'address', 'text', 120, true, true, false, false, false, true),
  ('object', 'entrance_info', 'order_field_entrance_info', 'additional', 'multiline', 130, true, true, false, false, false, true),
  ('object', 'parking_notes', 'order_field_parking_notes', 'additional', 'multiline', 140, true, true, false, false, false, true),
  ('object', 'geo_lat', 'order_field_geo_lat', 'additional', 'number', 150, true, true, false, false, false, true),
  ('object', 'geo_lng', 'order_field_geo_lng', 'additional', 'number', 160, true, true, false, false, false, true)
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

alter table public.entity_field_catalog enable row level security;
alter table public.company_entity_field_settings enable row level security;

drop policy if exists entity_field_catalog_select_all on public.entity_field_catalog;
create policy entity_field_catalog_select_all
on public.entity_field_catalog
for select
to authenticated
using (true);

drop policy if exists company_entity_field_settings_select_company on public.company_entity_field_settings;
create policy company_entity_field_settings_select_company
on public.company_entity_field_settings
for select
to authenticated
using (company_id = user_company_id());

drop policy if exists company_entity_field_settings_insert_admin on public.company_entity_field_settings;
create policy company_entity_field_settings_insert_admin
on public.company_entity_field_settings
for insert
to authenticated
with check (company_id = user_company_id() and is_admin());

drop policy if exists company_entity_field_settings_update_admin on public.company_entity_field_settings;
create policy company_entity_field_settings_update_admin
on public.company_entity_field_settings
for update
to authenticated
using (company_id = user_company_id() and is_admin())
with check (company_id = user_company_id() and is_admin());

drop policy if exists company_entity_field_settings_delete_admin on public.company_entity_field_settings;
create policy company_entity_field_settings_delete_admin
on public.company_entity_field_settings
for delete
to authenticated
using (company_id = user_company_id() and is_admin());

create or replace function public.get_company_entity_field_settings(p_entity_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_entity_type text;
  v_version_token timestamptz;
  v_payload jsonb;
begin
  v_company_id := user_company_id();
  v_entity_type := lower(trim(coalesce(p_entity_type, '')));

  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  if v_company_id is null then
    raise exception 'COMPANY_NOT_FOUND' using errcode = '22023';
  end if;

  if v_entity_type not in ('order', 'object') then
    raise exception 'INVALID_ENTITY_TYPE' using errcode = '22023';
  end if;

  select max(updated_at)
    into v_version_token
    from public.company_entity_field_settings
   where company_id = v_company_id
     and entity_type = v_entity_type;

  select jsonb_build_object(
    'entity_type', v_entity_type,
    'version_token', v_version_token,
    'fields', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'field_key', c.field_key,
          'label_key', c.label_key,
          'section_key', c.section_key,
          'input_kind', c.input_kind,
          'sort_order', c.sort_order,
          'supports_required', c.supports_required,
          'locked_enabled', c.locked_enabled,
          'locked_required', c.locked_required,
          'is_enabled',
            case
              when c.locked_enabled then true
              else coalesce(s.is_enabled, c.default_enabled)
            end,
          'is_required',
            case
              when c.locked_required then true
              when (
                case
                  when c.locked_enabled then true
                  else coalesce(s.is_enabled, c.default_enabled)
                end
              ) = false then false
              when c.supports_required = false then false
              else coalesce(s.is_required, c.default_required)
            end
        )
        order by c.sort_order, c.field_key
      ),
      '[]'::jsonb
    )
  )
    into v_payload
    from public.entity_field_catalog c
    left join public.company_entity_field_settings s
      on s.company_id = v_company_id
     and s.entity_type = c.entity_type
     and s.field_key = c.field_key
   where c.entity_type = v_entity_type
     and c.is_active = true;

  return coalesce(v_payload, jsonb_build_object('entity_type', v_entity_type, 'version_token', null, 'fields', '[]'::jsonb));
end;
$$;

create or replace function public.save_company_entity_field_settings(
  p_entity_type text,
  p_fields jsonb,
  p_expected_version timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_entity_type text;
  v_current_version timestamptz;
begin
  v_company_id := user_company_id();
  v_entity_type := lower(trim(coalesce(p_entity_type, '')));

  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  if v_company_id is null then
    raise exception 'COMPANY_NOT_FOUND' using errcode = '22023';
  end if;

  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if v_entity_type not in ('order', 'object') then
    raise exception 'INVALID_ENTITY_TYPE' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_fields, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_FIELDS_PAYLOAD' using errcode = '22023';
  end if;

  select max(updated_at)
    into v_current_version
    from public.company_entity_field_settings
   where company_id = v_company_id
     and entity_type = v_entity_type;

  if p_expected_version is distinct from v_current_version then
    raise exception 'FIELD_SETTINGS_CONFLICT' using errcode = '40001';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb)) as item
     where not exists (
       select 1
         from public.entity_field_catalog c
        where c.entity_type = v_entity_type
          and c.field_key = trim(coalesce(item ->> 'field_key', ''))
          and c.is_active = true
     )
  ) then
    raise exception 'UNKNOWN_FIELD_KEY' using errcode = '22023';
  end if;

  delete from public.company_entity_field_settings
   where company_id = v_company_id
     and entity_type = v_entity_type;

  insert into public.company_entity_field_settings (
    company_id,
    entity_type,
    field_key,
    is_enabled,
    is_required
  )
  select
    v_company_id,
    c.entity_type,
    c.field_key,
    case
      when c.locked_enabled then true
      else coalesce((item.value ->> 'is_enabled')::boolean, c.default_enabled)
    end as is_enabled,
    case
      when c.locked_required then true
      when c.supports_required = false then false
      when (
        case
          when c.locked_enabled then true
          else coalesce((item.value ->> 'is_enabled')::boolean, c.default_enabled)
        end
      ) = false then false
      else coalesce((item.value ->> 'is_required')::boolean, c.default_required)
    end as is_required
    from public.entity_field_catalog c
    left join lateral (
      select value
        from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb)) as payload(value)
       where trim(coalesce(payload.value ->> 'field_key', '')) = c.field_key
       limit 1
    ) item on true
   where c.entity_type = v_entity_type
     and c.is_active = true;

  return public.get_company_entity_field_settings(v_entity_type);
end;
$$;

grant execute on function public.get_company_entity_field_settings(text) to authenticated, service_role;
grant execute on function public.save_company_entity_field_settings(text, jsonb, timestamptz) to authenticated, service_role;
grant select, insert, update, delete on public.company_entity_field_settings to service_role;
grant select on public.entity_field_catalog to service_role;

commit;
