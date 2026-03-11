begin;

alter table public.entity_field_catalog
  drop constraint if exists entity_field_catalog_entity_type_check;

alter table public.entity_field_catalog
  add constraint entity_field_catalog_entity_type_check
  check (entity_type in ('order', 'object', 'client', 'employee'));

alter table public.company_entity_field_settings
  drop constraint if exists company_entity_field_settings_entity_type_check;

alter table public.company_entity_field_settings
  add constraint company_entity_field_settings_entity_type_check
  check (entity_type in ('order', 'object', 'client', 'employee'));

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
  ('client', 'first_name', 'label_first_name', 'personal', 'text', 10, true, true, true, true, true, true),
  ('client', 'last_name', 'label_last_name', 'personal', 'text', 20, true, true, false, false, false, true),
  ('client', 'middle_name', 'label_middle_name', 'personal', 'text', 30, true, true, false, false, false, true),
  ('client', 'comment', 'clients_comment_label', 'additional', 'multiline', 40, true, true, false, false, false, true),
  ('client', 'email', 'label_email', 'contact', 'email', 50, true, true, false, false, false, true),
  ('client', 'phone', 'view_label_phone', 'contact', 'phone', 60, true, true, true, true, true, true),
  ('client', 'additional_phone_1', 'order_field_secondary_phone', 'contact', 'phone', 70, true, true, false, false, false, true),
  ('client', 'additional_phone_2', 'client_field_additional_phone_2', 'contact', 'phone', 80, true, true, false, false, false, true),
  ('client', 'additional_phone_3', 'client_field_additional_phone_3', 'contact', 'phone', 90, true, true, false, false, false, true),
  ('employee', 'avatar_url', 'profile_photo_title', 'media', 'media', 10, false, true, false, false, false, true),
  ('employee', 'first_name', 'label_first_name', 'personal', 'text', 20, true, true, true, true, true, true),
  ('employee', 'last_name', 'label_last_name', 'personal', 'text', 30, true, true, true, true, true, true),
  ('employee', 'email', 'label_email', 'contact', 'email', 40, true, true, true, true, true, true),
  ('employee', 'phone', 'view_label_phone', 'contact', 'phone', 50, true, true, false, false, false, true),
  ('employee', 'birthdate', 'label_birthdate', 'personal', 'date', 60, true, true, false, false, false, true),
  ('employee', 'department_id', 'label_department', 'company', 'select', 70, true, true, false, false, false, true),
  ('employee', 'role', 'label_role', 'company', 'select', 80, false, true, true, true, true, true)
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

  if v_entity_type not in ('order', 'object', 'client', 'employee') then
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

  return coalesce(
    v_payload,
    jsonb_build_object('entity_type', v_entity_type, 'version_token', null, 'fields', '[]'::jsonb)
  );
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

  if v_entity_type not in ('order', 'object', 'client', 'employee') then
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

commit;
