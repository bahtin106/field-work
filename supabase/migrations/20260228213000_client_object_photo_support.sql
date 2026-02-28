alter table public.client_objects
  add column if not exists photo_url text;

comment on column public.client_objects.photo_url is
  'Public or signed URL of the object photo stored in avatars bucket under profiles/objects/<object_id>/...';

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
    raise exception 'client % not found', new.client_id using errcode = '23503';
  end if;

  new.company_id := v_company_id;
  new.name := nullif(trim(coalesce(new.name, '')), '');
  if new.name is null then
    new.name := 'Объект';
  end if;

  new.photo_url := nullif(trim(coalesce(new.photo_url, '')), '');
  new.country := nullif(trim(coalesce(new.country, '')), '');
  new.region := nullif(trim(coalesce(new.region, '')), '');
  new.city := nullif(trim(coalesce(new.city, '')), '');
  new.street := nullif(trim(coalesce(new.street, '')), '');
  new.house := nullif(trim(coalesce(new.house, '')), '');
  new.postal_code := nullif(trim(coalesce(new.postal_code, '')), '');
  new.building := nullif(trim(coalesce(new.building, '')), '');
  new.floor := nullif(trim(coalesce(new.floor, '')), '');
  new.entrance := nullif(trim(coalesce(new.entrance, '')), '');
  new.apartment := nullif(trim(coalesce(new.apartment, '')), '');
  new.intercom := nullif(trim(coalesce(new.intercom, '')), '');
  new.entrance_info := nullif(trim(coalesce(new.entrance_info, '')), '');
  new.parking_notes := nullif(trim(coalesce(new.parking_notes, '')), '');
  new.geo_lat := nullif(trim(coalesce(new.geo_lat, '')), '');
  new.geo_lng := nullif(trim(coalesce(new.geo_lng, '')), '');
  new.summary := public.client_object_summary(
    new.country,
    new.region,
    new.city,
    new.street,
    new.house,
    new.building,
    new.entrance,
    new.apartment
  );
  new.updated_at := now();
  new.updated_by := auth.uid();

  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());

    if not exists (
      select 1
        from public.client_objects o
       where o.client_id = new.client_id
    ) then
      new.is_primary := true;
    end if;
  end if;

  if new.is_primary then
    update public.client_objects
       set is_primary = false,
           updated_at = now(),
           updated_by = auth.uid()
     where client_id = new.client_id
       and id <> new.id
       and is_primary = true;
  end if;

  return new;
end;
$$;

create or replace function public.compute_company_storage_usage_bytes(p_company_id uuid)
returns table(
  data_bytes bigint,
  media_orders_bytes bigint,
  media_avatars_bytes bigint,
  media_bytes bigint,
  total_bytes bigint,
  data_tables_breakdown jsonb
)
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_data_bytes bigint := 0;
  v_media_orders_bytes bigint := 0;
  v_media_avatars_bytes bigint := 0;
  v_client_avatar_bytes bigint := 0;
  v_object_photo_bytes bigint := 0;
  v_table_bytes bigint := 0;
  v_data_breakdown jsonb := '{}'::jsonb;
  v_profiles_has_user_id boolean := false;
  rec record;
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  for rec in
    select c.table_schema, c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'company_id'
      and t.table_type = 'BASE TABLE'
      and c.table_name <> 'company_storage_usage_cache'
    group by c.table_schema, c.table_name
    order by c.table_name
  loop
    execute format(
      'SELECT COALESCE(SUM(pg_column_size(x)), 0)::bigint FROM %I.%I x WHERE x.company_id = $1',
      rec.table_schema,
      rec.table_name
    )
    into v_table_bytes
    using p_company_id;

    v_table_bytes := coalesce(v_table_bytes, 0);
    v_data_bytes := v_data_bytes + v_table_bytes;

    if v_table_bytes > 0 then
      v_data_breakdown := v_data_breakdown || jsonb_build_object(rec.table_name, v_table_bytes);
    end if;
  end loop;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'profiles'
      and c.column_name = 'user_id'
  )
  into v_profiles_has_user_id;

  if to_regclass('storage.objects') is not null
     and to_regclass('public.orders') is not null then
    select coalesce(
      sum(
        case
          when coalesce(o.metadata->>'size', '') ~ '^[0-9]+$'
            then (o.metadata->>'size')::bigint
          else 0
        end
      ),
      0
    )::bigint
    into v_media_orders_bytes
    from storage.objects o
    join public.orders ord
      on ord.id::text = split_part(o.name, '/', 2)
    where o.bucket_id = 'orders-photos'
      and split_part(o.name, '/', 1) = 'orders'
      and ord.company_id = p_company_id;
  end if;

  if to_regclass('storage.objects') is not null
     and to_regclass('public.profiles') is not null then
    if v_profiles_has_user_id then
      select coalesce(
        sum(
          case
            when coalesce(o.metadata->>'size', '') ~ '^[0-9]+$'
              then (o.metadata->>'size')::bigint
            else 0
          end
        ),
        0
      )::bigint
      into v_media_avatars_bytes
      from storage.objects o
      join public.profiles p
        on split_part(o.name, '/', 2) <> 'clients'
       and split_part(o.name, '/', 2) <> 'objects'
       and (p.id::text = split_part(o.name, '/', 2) or p.user_id::text = split_part(o.name, '/', 2))
      where o.bucket_id = 'avatars'
        and split_part(o.name, '/', 1) = 'profiles'
        and p.company_id = p_company_id;
    else
      select coalesce(
        sum(
          case
            when coalesce(o.metadata->>'size', '') ~ '^[0-9]+$'
              then (o.metadata->>'size')::bigint
            else 0
          end
        ),
        0
      )::bigint
      into v_media_avatars_bytes
      from storage.objects o
      join public.profiles p
        on split_part(o.name, '/', 2) <> 'clients'
       and split_part(o.name, '/', 2) <> 'objects'
       and p.id::text = split_part(o.name, '/', 2)
      where o.bucket_id = 'avatars'
        and split_part(o.name, '/', 1) = 'profiles'
        and p.company_id = p_company_id;
    end if;
  end if;

  if to_regclass('storage.objects') is not null
     and to_regclass('public.clients') is not null then
    select coalesce(
      sum(
        case
          when coalesce(o.metadata->>'size', '') ~ '^[0-9]+$'
            then (o.metadata->>'size')::bigint
          else 0
        end
      ),
      0
    )::bigint
    into v_client_avatar_bytes
    from storage.objects o
    join public.clients c
      on c.id::text = split_part(o.name, '/', 3)
    where o.bucket_id = 'avatars'
      and split_part(o.name, '/', 1) = 'profiles'
      and split_part(o.name, '/', 2) = 'clients'
      and c.company_id = p_company_id;
  end if;

  if to_regclass('storage.objects') is not null
     and to_regclass('public.client_objects') is not null then
    select coalesce(
      sum(
        case
          when coalesce(o.metadata->>'size', '') ~ '^[0-9]+$'
            then (o.metadata->>'size')::bigint
          else 0
        end
      ),
      0
    )::bigint
    into v_object_photo_bytes
    from storage.objects o
    join public.client_objects co
      on co.id::text = split_part(o.name, '/', 3)
    where o.bucket_id = 'avatars'
      and split_part(o.name, '/', 1) = 'profiles'
      and split_part(o.name, '/', 2) = 'objects'
      and co.company_id = p_company_id;
  end if;

  v_media_avatars_bytes :=
    coalesce(v_media_avatars_bytes, 0)
    + coalesce(v_client_avatar_bytes, 0)
    + coalesce(v_object_photo_bytes, 0);

  return query
  select
    v_data_bytes,
    v_media_orders_bytes,
    v_media_avatars_bytes,
    (v_media_orders_bytes + v_media_avatars_bytes) as media_bytes,
    (v_data_bytes + v_media_orders_bytes + v_media_avatars_bytes) as total_bytes,
    v_data_breakdown;
end;
$$;

create or replace function public.can_upload_storage_object(
  p_bucket_id text,
  p_name text,
  p_size_bytes bigint default 0
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_company_id uuid;
  v_total_bytes bigint := 0;
  v_limit_bytes bigint := public.company_storage_limit_bytes();
  v_prefix text;
  v_entity_id text;
  v_child_entity_id text;
  v_size_bytes bigint := greatest(coalesce(p_size_bytes, 0), 0);
  v_profiles_has_user_id boolean := false;
begin
  if p_bucket_id is null or p_name is null or btrim(p_name) = '' then
    return false;
  end if;

  v_prefix := split_part(p_name, '/', 1);
  v_entity_id := split_part(p_name, '/', 2);
  v_child_entity_id := split_part(p_name, '/', 3);

  if p_bucket_id = 'orders-photos' and v_prefix = 'orders' then
    select o.company_id
    into v_company_id
    from public.orders o
    where o.id::text = v_entity_id
    limit 1;
  elsif p_bucket_id = 'avatars' and v_prefix = 'profiles' then
    if v_entity_id = 'clients' and to_regclass('public.clients') is not null then
      select c.company_id
      into v_company_id
      from public.clients c
      where c.id::text = v_child_entity_id
      limit 1;
    elsif v_entity_id = 'objects' and to_regclass('public.client_objects') is not null then
      select co.company_id
      into v_company_id
      from public.client_objects co
      where co.id::text = v_child_entity_id
      limit 1;
    else
      select exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'profiles'
          and c.column_name = 'user_id'
      )
      into v_profiles_has_user_id;

      if v_profiles_has_user_id then
        select p.company_id
        into v_company_id
        from public.profiles p
        where p.id::text = v_entity_id or p.user_id::text = v_entity_id
        limit 1;
      else
        select p.company_id
        into v_company_id
        from public.profiles p
        where p.id::text = v_entity_id
        limit 1;
      end if;
    end if;
  else
    return false;
  end if;

  if v_company_id is null or not public.can_read_company_storage(v_company_id) then
    return false;
  end if;

  select x.total_bytes
  into v_total_bytes
  from public.compute_company_storage_usage_bytes(v_company_id) x;

  return (coalesce(v_total_bytes, 0) + v_size_bytes) <= v_limit_bytes;
end;
$$;

create or replace function public.resolve_company_id_for_storage_object(
  p_bucket_id text,
  p_name text
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_prefix text;
  v_entity_id text;
  v_child_entity_id text;
  v_company_id uuid;
  v_profiles_has_user_id boolean := false;
begin
  if p_bucket_id is null or p_name is null or btrim(p_name) = '' then
    return null;
  end if;

  v_prefix := split_part(p_name, '/', 1);
  v_entity_id := split_part(p_name, '/', 2);
  v_child_entity_id := split_part(p_name, '/', 3);

  if p_bucket_id = 'orders-photos' and v_prefix = 'orders' then
    select o.company_id
    into v_company_id
    from public.orders o
    where o.id::text = v_entity_id
    limit 1;
    return v_company_id;
  end if;

  if p_bucket_id = 'avatars' and v_prefix = 'profiles' then
    if v_entity_id = 'clients' and to_regclass('public.clients') is not null then
      select c.company_id
      into v_company_id
      from public.clients c
      where c.id::text = v_child_entity_id
      limit 1;
      return v_company_id;
    end if;

    if v_entity_id = 'objects' and to_regclass('public.client_objects') is not null then
      select co.company_id
      into v_company_id
      from public.client_objects co
      where co.id::text = v_child_entity_id
      limit 1;
      return v_company_id;
    end if;

    select exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'profiles'
        and c.column_name = 'user_id'
    )
    into v_profiles_has_user_id;

    if v_profiles_has_user_id then
      select p.company_id
      into v_company_id
      from public.profiles p
      where p.id::text = v_entity_id or p.user_id::text = v_entity_id
      limit 1;
      return v_company_id;
    end if;

    select p.company_id
    into v_company_id
    from public.profiles p
    where p.id::text = v_entity_id
    limit 1;
    return v_company_id;
  end if;

  return null;
end;
$$;
