begin;

create index if not exists trash_entries_company_type_deleted_idx
  on public.trash_entries (company_id, entity_type, deleted_at desc)
  where is_root;
create index if not exists trash_entries_company_deleted_by_idx
  on public.trash_entries (company_id, deleted_by, deleted_at desc)
  where is_root;

create or replace function public.trash_entry_order_id(p_entry public.trash_entries)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when p_entry.entity_type = 'order' then p_entry.entity_id
    when p_entry.entity_type = 'media' and p_entry.record_data ->> 'owner_type' = 'order'
      then nullif(p_entry.record_data ->> 'owner_id', '')::uuid
    when p_entry.entity_type = 'media' and p_entry.record_data ->> 'owner_type' = 'finance_entry'
      then nullif(p_entry.record_data ->> 'parent_order_id', '')::uuid
    else null
  end;
$$;

create or replace function public.trash_entry_object_id(p_entry public.trash_entries)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when p_entry.entity_type = 'client_object' then p_entry.entity_id
    when p_entry.entity_type = 'order'
      then nullif(p_entry.record_data ->> 'object_id', '')::uuid
    when p_entry.entity_type = 'media' and p_entry.record_data ->> 'owner_type' = 'object'
      then nullif(p_entry.record_data ->> 'owner_id', '')::uuid
    when p_entry.entity_type = 'media' and p_entry.record_data ->> 'owner_type' in ('order', 'finance_entry') then (
      select o.object_id
      from public.orders o
      where o.id = public.trash_entry_order_id(p_entry)
        and o.company_id = p_entry.company_id
      limit 1
    )
    else null
  end;
$$;

create or replace function public.trash_entry_client_id(p_entry public.trash_entries)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when p_entry.entity_type = 'client' then p_entry.entity_id
    when p_entry.entity_type = 'client_object'
      then nullif(p_entry.record_data ->> 'client_id', '')::uuid
    when p_entry.entity_type = 'order'
      then nullif(p_entry.record_data ->> 'client_id', '')::uuid
    when p_entry.entity_type = 'media' then coalesce(
      (
        select o.client_id
        from public.orders o
        where o.id = public.trash_entry_order_id(p_entry)
          and o.company_id = p_entry.company_id
        limit 1
      ),
      (
        select o.client_id
        from public.client_objects o
        where o.id = public.trash_entry_object_id(p_entry)
          and o.company_id = p_entry.company_id
        limit 1
      )
    )
    else null
  end;
$$;

revoke all on function public.trash_entry_order_id(public.trash_entries) from public, anon, authenticated;
revoke all on function public.trash_entry_object_id(public.trash_entries) from public, anon, authenticated;
revoke all on function public.trash_entry_client_id(public.trash_entries) from public, anon, authenticated;
grant execute on function public.trash_entry_order_id(public.trash_entries) to service_role;
grant execute on function public.trash_entry_object_id(public.trash_entries) to service_role;
grant execute on function public.trash_entry_client_id(public.trash_entries) to service_role;

create or replace function public.trash_item_matches_filters(
  p_entry public.trash_entries,
  p_filters jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_entity_types text[] := array(select jsonb_array_elements_text(coalesce(v_filters -> 'entityTypes', '[]'::jsonb)));
  v_deleted_by_ids text[] := array(select jsonb_array_elements_text(coalesce(v_filters -> 'deletedByIds', '[]'::jsonb)));
  v_statuses text[] := array(select jsonb_array_elements_text(coalesce(v_filters -> 'statuses', '[]'::jsonb)));
  v_work_types text[] := array(select jsonb_array_elements_text(coalesce(v_filters -> 'workTypes', '[]'::jsonb)));
  v_client_ids text[] := array(select jsonb_array_elements_text(coalesce(v_filters -> 'clientIds', '[]'::jsonb)));
  v_executor_ids text[] := array(select jsonb_array_elements_text(coalesce(v_filters -> 'executorIds', '[]'::jsonb)));
  v_client_tags text[] := array(select jsonb_array_elements_text(coalesce(v_filters -> 'clientTags', '[]'::jsonb)));
  v_object_tags text[] := array(select jsonb_array_elements_text(coalesce(v_filters -> 'objectTags', '[]'::jsonb)));
  v_cities text[] := array(select jsonb_array_elements_text(coalesce(v_filters -> 'cities', '[]'::jsonb)));
  v_streets text[] := array(select jsonb_array_elements_text(coalesce(v_filters -> 'streets', '[]'::jsonb)));
  v_media_owner_types text[] := array(select jsonb_array_elements_text(coalesce(v_filters -> 'mediaOwnerTypes', '[]'::jsonb)));
  v_order_id uuid := public.trash_entry_order_id(p_entry);
  v_object_id uuid := public.trash_entry_object_id(p_entry);
  v_client_id uuid := public.trash_entry_client_id(p_entry);
  v_order jsonb;
  v_object jsonb;
  v_departure timestamptz;
  v_created timestamptz;
  v_amount numeric;
  v_timezone text;
begin
  if cardinality(v_entity_types) > 0 and not (p_entry.entity_type = any(v_entity_types)) then return false; end if;
  if cardinality(v_deleted_by_ids) > 0 and not (coalesce(p_entry.deleted_by::text, '') = any(v_deleted_by_ids)) then return false; end if;
  if nullif(v_filters ->> 'deletedDateFrom', '') is not null
     and p_entry.deleted_at < (v_filters ->> 'deletedDateFrom')::timestamptz then return false; end if;
  if nullif(v_filters ->> 'deletedDateTo', '') is not null
     and p_entry.deleted_at > (v_filters ->> 'deletedDateTo')::timestamptz then return false; end if;
  if cardinality(v_media_owner_types) > 0 and not (
    p_entry.entity_type = 'media'
    and coalesce(p_entry.record_data ->> 'owner_type', '') = any(v_media_owner_types)
  ) then return false; end if;

  if v_order_id is not null then
    if p_entry.entity_type = 'order' then
      v_order := p_entry.record_data;
    else
      select to_jsonb(o) into v_order
      from public.orders o
      where o.id = v_order_id and o.company_id = p_entry.company_id
      limit 1;
    end if;
  end if;
  if v_object_id is not null then
    if p_entry.entity_type = 'client_object' then
      v_object := p_entry.record_data;
    else
      select to_jsonb(o) into v_object
      from public.client_objects o
      where o.id = v_object_id and o.company_id = p_entry.company_id
      limit 1;
    end if;
  end if;

  if cardinality(v_statuses) > 0 and not (coalesce(v_order ->> 'status', '') = any(v_statuses)) then return false; end if;
  if cardinality(v_work_types) > 0 and not (coalesce(v_order ->> 'work_type_id', '') = any(v_work_types)) then return false; end if;
  if cardinality(v_client_ids) > 0 and not (coalesce(v_client_id::text, '') = any(v_client_ids)) then return false; end if;
  if cardinality(v_executor_ids) > 0 and not (coalesce(v_order ->> 'assigned_to', '') = any(v_executor_ids)) then return false; end if;

  if cardinality(v_cities) > 0 and not (
    coalesce(nullif(v_object ->> 'city', ''), nullif(v_order ->> 'city', ''), '') = any(v_cities)
  ) then return false; end if;
  if cardinality(v_streets) > 0 and not (
    coalesce(nullif(v_object ->> 'street', ''), nullif(v_order ->> 'street', ''), '') = any(v_streets)
  ) then return false; end if;

  if cardinality(v_client_tags) > 0 and not exists (
    select 1
    from public.client_tag_links l
    join public.company_tags tag on tag.id = l.tag_id and tag.company_id = p_entry.company_id
    where l.client_id = v_client_id and l.company_id = p_entry.company_id
      and tag.tag_type = 'client' and tag.value = any(v_client_tags)
  ) then return false; end if;
  if cardinality(v_object_tags) > 0 and not exists (
    select 1
    from public.object_tag_links l
    join public.company_tags tag on tag.id = l.tag_id and tag.company_id = p_entry.company_id
    where l.object_id = v_object_id and l.company_id = p_entry.company_id
      and tag.tag_type = 'object' and tag.value = any(v_object_tags)
  ) then return false; end if;

  if nullif(v_order ->> 'time_window_start', '') is not null then
    v_departure := (v_order ->> 'time_window_start')::timestamptz;
  elsif nullif(v_order ->> 'departure_at', '') is not null then
    v_departure := (v_order ->> 'departure_at')::timestamptz;
  end if;
  if nullif(v_filters ->> 'departureDateFrom', '') is not null
     and (v_departure is null or v_departure < (v_filters ->> 'departureDateFrom')::timestamptz) then return false; end if;
  if nullif(v_filters ->> 'departureDateTo', '') is not null
     and (v_departure is null or v_departure > (v_filters ->> 'departureDateTo')::timestamptz) then return false; end if;
  if nullif(v_filters ->> 'departureTimeFrom', '') is not null and (
    nullif(v_order ->> 'departure_time', '') is null
    or (v_order ->> 'departure_time')::time < (v_filters ->> 'departureTimeFrom')::time
  ) then return false; end if;
  if nullif(v_filters ->> 'departureTimeTo', '') is not null and (
    nullif(v_order ->> 'departure_time', '') is null
    or (v_order ->> 'departure_time')::time > (v_filters ->> 'departureTimeTo')::time
  ) then return false; end if;

  if nullif(v_order ->> 'created_at', '') is not null then v_created := (v_order ->> 'created_at')::timestamptz; end if;
  select coalesce(nullif(c.timezone, ''), 'UTC') into v_timezone
  from public.companies c where c.id = p_entry.company_id;
  v_timezone := coalesce(v_timezone, 'UTC');
  if nullif(v_filters ->> 'createdDateFrom', '') is not null
     and (v_created is null or v_created < (v_filters ->> 'createdDateFrom')::timestamptz) then return false; end if;
  if nullif(v_filters ->> 'createdDateTo', '') is not null
     and (v_created is null or v_created > (v_filters ->> 'createdDateTo')::timestamptz) then return false; end if;
  if nullif(v_filters ->> 'createdTimeFrom', '') is not null and (
    v_created is null or (v_created at time zone v_timezone)::time < (v_filters ->> 'createdTimeFrom')::time
  ) then return false; end if;
  if nullif(v_filters ->> 'createdTimeTo', '') is not null and (
    v_created is null or (v_created at time zone v_timezone)::time > (v_filters ->> 'createdTimeTo')::time
  ) then return false; end if;

  if coalesce(v_order ->> 'start_price', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
    v_amount := (v_order ->> 'start_price')::numeric;
  end if;
  if nullif(v_filters ->> 'sumMin', '') is not null
     and (v_amount is null or v_amount < (v_filters ->> 'sumMin')::numeric) then return false; end if;
  if nullif(v_filters ->> 'sumMax', '') is not null
     and (v_amount is null or v_amount > (v_filters ->> 'sumMax')::numeric) then return false; end if;

  return true;
end;
$$;

revoke all on function public.trash_item_matches_filters(public.trash_entries,jsonb) from public, anon, authenticated;
grant execute on function public.trash_item_matches_filters(public.trash_entries,jsonb) to service_role;

create or replace function public.list_trash_items_v2(
  p_search text default null,
  p_filters jsonb default '{}'::jsonb,
  p_sort text default 'purge_at',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  thumbnail_url text,
  deleted_at timestamptz,
  purge_at timestamptz,
  deleted_by uuid,
  deleted_by_name text,
  child_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.current_user_has_trash_permission('canViewTrash') then
    raise exception 'Trash access denied' using errcode = '42501';
  end if;
  return query
  select
    t.id, t.entity_type, t.entity_id, t.title, t.subtitle, t.thumbnail_url,
    t.deleted_at, t.purge_at, t.deleted_by, p.full_name,
    (select count(*) from public.trash_entries c where c.parent_entry_id = t.id),
    count(*) over ()
  from public.trash_entries t
  left join public.profiles p on p.id = t.deleted_by
  where t.is_root
    and t.company_id = public.user_company_id()
    and auth.uid() = any(t.access_user_ids)
    and (
      p_search is null or btrim(p_search) = ''
      or t.title ilike '%' || btrim(p_search) || '%'
      or coalesce(t.subtitle, '') ilike '%' || btrim(p_search) || '%'
    )
    and public.trash_item_matches_filters(t, p_filters)
  order by
    case when p_sort = 'deleted_desc' then t.deleted_at end desc,
    case when p_sort = 'title' then lower(t.title) end asc,
    t.purge_at asc,
    t.id
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create or replace function public.list_trash_item_ids_v2(
  p_search text default null,
  p_filters jsonb default '{}'::jsonb
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_ids uuid[];
begin
  if not public.current_user_has_trash_permission('canViewTrash') then
    raise exception 'Trash access denied' using errcode = '42501';
  end if;
  select coalesce(array_agg(t.id order by t.purge_at, t.id), '{}'::uuid[]) into v_ids
  from public.trash_entries t
  where t.is_root
    and t.company_id = public.user_company_id()
    and auth.uid() = any(t.access_user_ids)
    and (
      p_search is null or btrim(p_search) = ''
      or t.title ilike '%' || btrim(p_search) || '%'
      or coalesce(t.subtitle, '') ilike '%' || btrim(p_search) || '%'
    )
    and public.trash_item_matches_filters(t, p_filters);
  return v_ids;
end;
$$;

create or replace function public.get_trash_filter_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_result jsonb;
begin
  if not public.current_user_has_trash_permission('canViewTrash') then
    raise exception 'Trash access denied' using errcode = '42501';
  end if;
  with base as materialized (
    select
      t.*,
      public.trash_entry_order_id(t) as order_id,
      public.trash_entry_object_id(t) as object_id,
      public.trash_entry_client_id(t) as client_id
    from public.trash_entries t
    where t.is_root and t.company_id = public.user_company_id()
      and auth.uid() = any(t.access_user_ids)
  ), orders_data as materialized (
    select b.id,
      case when b.entity_type = 'order' then b.record_data else to_jsonb(o) end as data
    from base b left join public.orders o on o.id = b.order_id and o.company_id = b.company_id
    where b.order_id is not null
  )
  select jsonb_build_object(
    'entityTypes', coalesce((select jsonb_agg(jsonb_build_object('id', entity_type, 'count', count) order by entity_type)
      from (select entity_type, count(*) count from base group by entity_type) q), '[]'::jsonb),
    'deletedBy', coalesce((select jsonb_agg(jsonb_build_object('id', deleted_by, 'label', label, 'count', count) order by label)
      from (select b.deleted_by, coalesce(nullif(p.full_name, ''), b.deleted_by::text) label, count(*) count
        from base b left join public.profiles p on p.id = b.deleted_by where b.deleted_by is not null
        group by b.deleted_by, p.full_name) q), '[]'::jsonb),
    'statuses', coalesce((select jsonb_agg(jsonb_build_object('id', value, 'label', value, 'count', count) order by value)
      from (select data ->> 'status' value, count(*) count from orders_data
        where nullif(data ->> 'status', '') is not null group by data ->> 'status') q), '[]'::jsonb),
    'workTypes', coalesce((select jsonb_agg(jsonb_build_object('id', value, 'label', label, 'count', count) order by label)
      from (select od.data ->> 'work_type_id' value,
          coalesce(nullif(w.name, ''), od.data ->> 'work_type_id') label, count(*) count
        from orders_data od left join public.work_types w on w.id = nullif(od.data ->> 'work_type_id', '')::uuid
        where nullif(od.data ->> 'work_type_id', '') is not null
        group by od.data ->> 'work_type_id', w.name) q), '[]'::jsonb),
    'clients', coalesce((select jsonb_agg(jsonb_build_object('id', client_id, 'label', label, 'count', count) order by label)
      from (select b.client_id,
          coalesce(nullif(trim(concat_ws(' ', c.last_name, c.first_name, c.middle_name)), ''),
            nullif(c.full_name, ''), b.client_id::text) label, count(*) count
        from base b left join public.clients c on c.id = b.client_id and c.company_id = b.company_id
        where b.client_id is not null group by b.client_id, c.last_name, c.first_name, c.middle_name, c.full_name) q), '[]'::jsonb),
    'executors', coalesce((select jsonb_agg(jsonb_build_object('id', value, 'label', label, 'count', count) order by label)
      from (select od.data ->> 'assigned_to' value,
          coalesce(nullif(p.full_name, ''), od.data ->> 'assigned_to') label, count(*) count
        from orders_data od left join public.profiles p on p.id = nullif(od.data ->> 'assigned_to', '')::uuid
        where nullif(od.data ->> 'assigned_to', '') is not null
        group by od.data ->> 'assigned_to', p.full_name) q), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(jsonb_build_object('id', value, 'label', value, 'count', count) order by value)
      from (select value, count(*) count from (
          select nullif(coalesce(o.city, od.data ->> 'city'), '') value
          from base b left join public.client_objects o on o.id = b.object_id and o.company_id = b.company_id
          left join orders_data od on od.id = b.id
        ) values_q where value is not null group by value) q), '[]'::jsonb),
    'streets', coalesce((select jsonb_agg(jsonb_build_object('id', value, 'label', value, 'count', count) order by value)
      from (select value, count(*) count from (
          select nullif(coalesce(o.street, od.data ->> 'street'), '') value
          from base b left join public.client_objects o on o.id = b.object_id and o.company_id = b.company_id
          left join orders_data od on od.id = b.id
        ) values_q where value is not null group by value) q), '[]'::jsonb),
    'clientTags', coalesce((select jsonb_agg(jsonb_build_object('id', value, 'label', value, 'count', count) order by value)
      from (select tag.value, count(distinct b.id) count from base b
        join public.client_tag_links l on l.client_id = b.client_id and l.company_id = b.company_id
        join public.company_tags tag on tag.id = l.tag_id and tag.company_id = b.company_id and tag.tag_type = 'client'
        group by tag.value) q), '[]'::jsonb),
    'objectTags', coalesce((select jsonb_agg(jsonb_build_object('id', value, 'label', value, 'count', count) order by value)
      from (select tag.value, count(distinct b.id) count from base b
        join public.object_tag_links l on l.object_id = b.object_id and l.company_id = b.company_id
        join public.company_tags tag on tag.id = l.tag_id and tag.company_id = b.company_id and tag.tag_type = 'object'
        group by tag.value) q), '[]'::jsonb),
    'mediaOwnerTypes', coalesce((select jsonb_agg(jsonb_build_object('id', value, 'count', count) order by value)
      from (select record_data ->> 'owner_type' value, count(*) count from base
        where entity_type = 'media' and nullif(record_data ->> 'owner_type', '') is not null
        group by record_data ->> 'owner_type') q), '[]'::jsonb)
  ) into v_result;
  return coalesce(v_result, '{}'::jsonb);
end;
$$;

create or replace function public.restore_trash_items(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_id uuid; v_expected integer; v_found integer; v_count integer := 0;
begin
  if not public.current_user_has_trash_permission('canRestoreTrash') then
    raise exception 'Trash restore denied' using errcode = '42501';
  end if;
  select count(distinct id) into v_expected from unnest(coalesce(p_ids, '{}'::uuid[])) id;
  if v_expected = 0 then return 0; end if;
  select count(*) into v_found from public.trash_entries t
    where t.id = any(p_ids) and t.is_root and t.company_id = public.user_company_id()
      and auth.uid() = any(t.access_user_ids);
  if v_found <> v_expected then raise exception 'Trash selection changed' using errcode = 'P0002'; end if;
  for v_id in
    select t.id from public.trash_entries t where t.id = any(p_ids)
    order by case when t.entity_type = 'media' then 1 else 0 end, t.deleted_at, t.id
  loop
    perform public.restore_trash_item(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.purge_trash_items(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_id uuid; v_expected integer; v_found integer; v_count integer := 0;
begin
  if not public.current_user_has_trash_permission('canPurgeTrash') then
    raise exception 'Trash purge denied' using errcode = '42501';
  end if;
  select count(distinct id) into v_expected from unnest(coalesce(p_ids, '{}'::uuid[])) id;
  if v_expected = 0 then return 0; end if;
  select count(*) into v_found from public.trash_entries t
    where t.id = any(p_ids) and t.is_root and t.company_id = public.user_company_id()
      and auth.uid() = any(t.access_user_ids);
  if v_found <> v_expected then raise exception 'Trash selection changed' using errcode = 'P0002'; end if;
  for v_id in
    select t.id from public.trash_entries t where t.id = any(p_ids)
    order by case when t.entity_type = 'media' then 0 else 1 end, t.deleted_at, t.id
  loop
    perform public.purge_trash_item(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.list_trash_items_v2(text,jsonb,text,integer,integer) from public, anon;
revoke all on function public.list_trash_item_ids_v2(text,jsonb) from public, anon;
revoke all on function public.get_trash_filter_options() from public, anon;
revoke all on function public.restore_trash_items(uuid[]) from public, anon;
revoke all on function public.purge_trash_items(uuid[]) from public, anon;
grant execute on function public.list_trash_items_v2(text,jsonb,text,integer,integer) to authenticated, service_role;
grant execute on function public.list_trash_item_ids_v2(text,jsonb) to authenticated, service_role;
grant execute on function public.get_trash_filter_options() to authenticated, service_role;
grant execute on function public.restore_trash_items(uuid[]) to authenticated, service_role;
grant execute on function public.purge_trash_items(uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
