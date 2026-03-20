begin;

alter table public.company_entity_field_settings
  add column if not exists custom_label text;

update public.company_entity_field_settings
set custom_label = nullif(left(btrim(coalesce(custom_label, '')), 64), '')
where custom_label is not null;

alter table public.company_entity_field_settings
  drop constraint if exists company_entity_field_settings_custom_label_len_check;

alter table public.company_entity_field_settings
  add constraint company_entity_field_settings_custom_label_len_check
  check (custom_label is null or char_length(custom_label) <= 64);

alter table public.orders
  add column if not exists media_file_5 text[];

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
  ('order', 'contract_file', 'order_media_field_1', 'media', 'media', 160, true, true, false, false, false, true),
  ('order', 'photo_before', 'order_media_field_2', 'media', 'media', 170, true, true, false, false, false, true),
  ('order', 'photo_after', 'order_media_field_3', 'media', 'media', 180, true, true, false, false, false, true),
  ('order', 'act_file', 'order_media_field_4', 'media', 'media', 190, true, true, false, false, false, true),
  ('order', 'media_file_5', 'order_media_field_5', 'media', 'media', 200, true, true, false, false, false, true)
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
          'custom_label', nullif(btrim(coalesce(s.custom_label, '')), ''),
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
    is_required,
    custom_label
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
    end as is_required,
    nullif(left(btrim(coalesce(item.value ->> 'custom_label', '')), 64), '') as custom_label
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

create or replace function public.append_order_media_url_v2(
  p_order_id uuid,
  p_company_id uuid,
  p_category text,
  p_url text
)
returns table(media_urls text[], updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_current text[];
  v_next text[];
  v_category text;
begin
  v_category := lower(trim(coalesce(p_category, '')));
  if v_category not in ('contract_file', 'photo_before', 'photo_after', 'act_file', 'media_file_5') then
    raise exception 'Unsupported category';
  end if;

  select *
    into v_order
    from public.orders
   where id = p_order_id
     and company_id = p_company_id
   for update;

  if not found then
    raise exception 'Order not found';
  end if;

  select coalesce(array_agg(value), '{}'::text[])
    into v_current
    from jsonb_array_elements_text(coalesce(to_jsonb(v_order) -> v_category, '[]'::jsonb));

  v_next := array(
    select x.val
      from (
        select e as val, min(ord) as first_ord
          from unnest(array[p_url] || coalesce(v_current, '{}'::text[])) with ordinality t(e, ord)
         where coalesce(e, '') <> ''
         group by e
      ) x
     order by x.first_ord
  );

  execute format(
    'update public.orders o
        set %I = $1,
            updated_at = now()
      where o.id = $2
      returning o.%I, o.updated_at',
    v_category,
    v_category
  )
  into media_urls, updated_at
  using v_next, v_order.id;

  return next;
end;
$$;

create or replace function public.remove_order_media_url_v2(
  p_order_id uuid,
  p_company_id uuid,
  p_category text,
  p_url text
)
returns table(media_urls text[], updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_current text[];
  v_next text[];
  v_category text;
begin
  v_category := lower(trim(coalesce(p_category, '')));
  if v_category not in ('contract_file', 'photo_before', 'photo_after', 'act_file', 'media_file_5') then
    raise exception 'Unsupported category';
  end if;

  select *
    into v_order
    from public.orders
   where id = p_order_id
     and company_id = p_company_id
   for update;

  if not found then
    raise exception 'Order not found';
  end if;

  select coalesce(array_agg(value), '{}'::text[])
    into v_current
    from jsonb_array_elements_text(coalesce(to_jsonb(v_order) -> v_category, '[]'::jsonb));

  v_next := array(
    select e
      from unnest(coalesce(v_current, '{}'::text[])) t(e)
     where coalesce(e, '') <> ''
       and e <> p_url
  );

  execute format(
    'update public.orders o
        set %I = nullif($1, ''{}''::text[]),
            updated_at = now()
      where o.id = $2
      returning o.%I, o.updated_at',
    v_category,
    v_category
  )
  into media_urls, updated_at
  using v_next, v_order.id;

  return next;
end;
$$;

grant execute on function public.get_company_entity_field_settings(text) to authenticated, service_role;
grant execute on function public.save_company_entity_field_settings(text, jsonb, timestamptz) to authenticated, service_role;
grant execute on function public.append_order_media_url_v2(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.remove_order_media_url_v2(uuid, uuid, text, text) to authenticated, service_role;

commit;
