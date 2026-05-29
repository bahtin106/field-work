create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  parent_order_id uuid null references public.orders(id) on delete cascade,
  category text not null,
  source_url text not null,
  display_url text null,
  thumb_url text null,
  provider text not null default 'unknown',
  storage_bucket text null,
  storage_path text null,
  mime_type text null,
  file_size_bytes bigint not null default 0,
  width integer null,
  height integer null,
  sort_order integer not null default 0,
  status text not null default 'ready',
  error_code text null,
  error_message text null,
  client_upload_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint media_assets_entity_type_check check (
    entity_type = any (array[
      'order',
      'object',
      'finance_entry',
      'employee',
      'client',
      'feedback',
      'feedback_attachment'
    ]::text[])
  ),
  constraint media_assets_provider_check check (
    provider = any (array['beget_s3', 'yandex_disk', 'supabase_storage', 'unknown']::text[])
  ),
  constraint media_assets_status_check check (
    status = any (array['queued', 'processing', 'ready', 'failed', 'deleted']::text[])
  ),
  constraint media_assets_source_url_nonblank_check check (btrim(source_url) <> ''),
  constraint media_assets_file_size_nonnegative_check check (file_size_bytes >= 0),
  constraint media_assets_dimensions_nonnegative_check check (
    (width is null or width >= 0) and (height is null or height >= 0)
  )
);

create unique index if not exists media_assets_entity_category_source_uidx
  on public.media_assets (entity_type, entity_id, category, source_url);

create index if not exists media_assets_company_entity_idx
  on public.media_assets (company_id, entity_type, entity_id, category, sort_order);

create index if not exists media_assets_parent_order_idx
  on public.media_assets (parent_order_id, category, sort_order)
  where parent_order_id is not null;

create index if not exists media_assets_status_idx
  on public.media_assets (status, updated_at);

alter table public.media_assets enable row level security;

drop policy if exists media_assets_service_role_all on public.media_assets;
create policy media_assets_service_role_all
  on public.media_assets
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists media_assets_select_company on public.media_assets;
create policy media_assets_select_company
  on public.media_assets
  for select
  to authenticated
  using (company_id = public.user_company_id());

create or replace function public.media_assets_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_media_assets_touch_updated_at on public.media_assets;
create trigger trg_media_assets_touch_updated_at
before update on public.media_assets
for each row execute function public.media_assets_touch_updated_at();

create or replace function public.media_assets_provider_from_url(p_url text, p_provider text default null)
returns text
language sql
immutable
as $$
  select case
    when btrim(coalesce(p_provider, '')) in ('beget_s3', 'yandex_disk', 'supabase_storage') then btrim(p_provider)
    when lower(coalesce(p_url, '')) like 'yadisk://%' then 'yandex_disk'
    when lower(coalesce(p_url, '')) like '%disk.yandex%' then 'yandex_disk'
    when lower(coalesce(p_url, '')) like '%yadi.sk%' then 'yandex_disk'
    when lower(coalesce(p_url, '')) like '%/storage/v1/object/%' then 'supabase_storage'
    when lower(coalesce(p_url, '')) like 'https://%' then 'beget_s3'
    else 'unknown'
  end
$$;

create or replace function public.media_assets_storage_bucket_from_url(p_url text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_url, '')) like '%/storage/v1/object/public/orders-photos/%' then 'orders-photos'
    when lower(coalesce(p_url, '')) like '%/storage/v1/object/public/avatars/%' then 'avatars'
    else null
  end
$$;

create or replace function public.media_assets_upsert(
  p_company_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_parent_order_id uuid,
  p_category text,
  p_source_url text,
  p_display_url text,
  p_provider text,
  p_storage_path text,
  p_file_size_bytes bigint,
  p_sort_order integer,
  p_status text default 'ready',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
  v_source_url text := btrim(coalesce(p_source_url, ''));
begin
  if p_company_id is null or p_entity_id is null or v_source_url = '' then
    return null;
  end if;

  insert into public.media_assets (
    company_id,
    entity_type,
    entity_id,
    parent_order_id,
    category,
    source_url,
    display_url,
    provider,
    storage_bucket,
    storage_path,
    file_size_bytes,
    sort_order,
    status,
    metadata
  )
  values (
    p_company_id,
    p_entity_type,
    p_entity_id,
    p_parent_order_id,
    p_category,
    v_source_url,
    nullif(btrim(coalesce(p_display_url, '')), ''),
    public.media_assets_provider_from_url(v_source_url, p_provider),
    public.media_assets_storage_bucket_from_url(v_source_url),
    nullif(btrim(coalesce(p_storage_path, '')), ''),
    greatest(coalesce(p_file_size_bytes, 0), 0),
    coalesce(p_sort_order, 0),
    coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'ready'),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (entity_type, entity_id, category, source_url)
  do update set
    company_id = excluded.company_id,
    parent_order_id = excluded.parent_order_id,
    display_url = coalesce(excluded.display_url, public.media_assets.display_url),
    provider = excluded.provider,
    storage_bucket = coalesce(excluded.storage_bucket, public.media_assets.storage_bucket),
    storage_path = coalesce(excluded.storage_path, public.media_assets.storage_path),
    file_size_bytes = greatest(excluded.file_size_bytes, public.media_assets.file_size_bytes),
    sort_order = excluded.sort_order,
    status = excluded.status,
    deleted_at = null,
    metadata = public.media_assets.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.media_assets_sync_order(p_order_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from public.media_assets
  where entity_type = 'order'
    and entity_id = p_order_id;

  insert into public.media_assets (
    company_id,
    entity_type,
    entity_id,
    parent_order_id,
    category,
    source_url,
    display_url,
    provider,
    storage_bucket,
    storage_path,
    file_size_bytes,
    sort_order,
    status,
    metadata
  )
  select
    o.company_id,
    'order',
    o.id,
    o.id,
    media.category,
    media.url,
    m.display_url,
    public.media_assets_provider_from_url(media.url, m.provider),
    public.media_assets_storage_bucket_from_url(media.url),
    m.external_path,
    greatest(coalesce(m.file_size_bytes, 0), 0),
    media.ord::integer,
    'ready',
    jsonb_build_object('source', 'orders_media_array')
  from public.orders o
  cross join lateral (
    select v.category, u.url, u.ord
    from (values
      ('media_file_1'::text, o.media_file_1),
      ('media_file_2'::text, o.media_file_2),
      ('media_file_3'::text, o.media_file_3),
      ('media_file_4'::text, o.media_file_4),
      ('media_file_5'::text, o.media_file_5)
    ) as v(category, urls)
    cross join lateral unnest(coalesce(v.urls, '{}'::text[])) with ordinality as u(url, ord)
    where btrim(coalesce(u.url, '')) <> ''
  ) media
  left join public.order_media_external_map m
    on m.order_id = o.id
   and m.category = media.category
   and m.source_url = media.url
  where o.id = p_order_id
  on conflict (entity_type, entity_id, category, source_url)
  do update set
    display_url = coalesce(excluded.display_url, public.media_assets.display_url),
    provider = excluded.provider,
    storage_bucket = coalesce(excluded.storage_bucket, public.media_assets.storage_bucket),
    storage_path = coalesce(excluded.storage_path, public.media_assets.storage_path),
    file_size_bytes = greatest(excluded.file_size_bytes, public.media_assets.file_size_bytes),
    sort_order = excluded.sort_order,
    status = 'ready',
    deleted_at = null,
    updated_at = now();
end;
$$;

create or replace function public.media_assets_sync_object(p_object_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from public.media_assets
  where entity_type = 'object'
    and entity_id = p_object_id
    and category like 'media_file_%';

  insert into public.media_assets (
    company_id,
    entity_type,
    entity_id,
    category,
    source_url,
    display_url,
    provider,
    storage_bucket,
    storage_path,
    file_size_bytes,
    sort_order,
    status,
    metadata
  )
  select
    o.company_id,
    'object',
    o.id,
    media.category,
    media.url,
    m.display_url,
    public.media_assets_provider_from_url(media.url, m.provider),
    public.media_assets_storage_bucket_from_url(media.url),
    m.external_path,
    greatest(coalesce(m.file_size_bytes, 0), 0),
    media.ord::integer,
    'ready',
    jsonb_build_object('source', 'object_media_array')
  from public.client_objects o
  cross join lateral (
    select v.category, u.url, u.ord
    from (values
      ('media_file_1'::text, o.media_file_1),
      ('media_file_2'::text, o.media_file_2),
      ('media_file_3'::text, o.media_file_3)
    ) as v(category, urls)
    cross join lateral unnest(coalesce(v.urls, '{}'::text[])) with ordinality as u(url, ord)
    where btrim(coalesce(u.url, '')) <> ''
  ) media
  left join public.object_media_external_map m
    on m.object_id = o.id
   and m.category = media.category
   and m.source_url = media.url
  where o.id = p_object_id
  on conflict (entity_type, entity_id, category, source_url)
  do update set
    display_url = coalesce(excluded.display_url, public.media_assets.display_url),
    provider = excluded.provider,
    storage_bucket = coalesce(excluded.storage_bucket, public.media_assets.storage_bucket),
    storage_path = coalesce(excluded.storage_path, public.media_assets.storage_path),
    file_size_bytes = greatest(excluded.file_size_bytes, public.media_assets.file_size_bytes),
    sort_order = excluded.sort_order,
    status = 'ready',
    deleted_at = null,
    updated_at = now();
end;
$$;

create or replace function public.media_assets_sync_finance_entry(p_entry_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from public.media_assets
  where entity_type = 'finance_entry'
    and entity_id = p_entry_id
    and category = 'finance_entry_photo';

  insert into public.media_assets (
    company_id,
    entity_type,
    entity_id,
    parent_order_id,
    category,
    source_url,
    display_url,
    provider,
    storage_bucket,
    storage_path,
    file_size_bytes,
    sort_order,
    status,
    metadata
  )
  select
    e.company_id,
    'finance_entry',
    e.id,
    e.order_id,
    'finance_entry_photo',
    media.url,
    m.display_url,
    public.media_assets_provider_from_url(media.url, m.provider),
    public.media_assets_storage_bucket_from_url(media.url),
    m.external_path,
    greatest(coalesce(m.file_size_bytes, 0), 0),
    media.ord::integer,
    'ready',
    jsonb_build_object('source', 'finance_entry_photo_urls')
  from public.order_finance_entries e
  cross join lateral unnest(coalesce(e.photo_urls, '{}'::text[])) with ordinality as media(url, ord)
  left join public.finance_entry_media_external_map m
    on m.finance_entry_id = e.id
   and m.source_url = media.url
  where e.id = p_entry_id
    and btrim(coalesce(media.url, '')) <> ''
  on conflict (entity_type, entity_id, category, source_url)
  do update set
    parent_order_id = excluded.parent_order_id,
    display_url = coalesce(excluded.display_url, public.media_assets.display_url),
    provider = excluded.provider,
    storage_bucket = coalesce(excluded.storage_bucket, public.media_assets.storage_bucket),
    storage_path = coalesce(excluded.storage_path, public.media_assets.storage_path),
    file_size_bytes = greatest(excluded.file_size_bytes, public.media_assets.file_size_bytes),
    sort_order = excluded.sort_order,
    status = 'ready',
    deleted_at = null,
    updated_at = now();
end;
$$;

create or replace function public.media_assets_sync_order_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.media_assets_sync_order(new.id);
  return new;
end;
$$;

create or replace function public.media_assets_sync_object_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.media_assets_sync_object(new.id);
  return new;
end;
$$;

create or replace function public.media_assets_sync_finance_entry_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.media_assets_sync_finance_entry(new.id);
  return new;
end;
$$;

drop trigger if exists trg_media_assets_sync_order on public.orders;
create trigger trg_media_assets_sync_order
after insert or update of media_file_1, media_file_2, media_file_3, media_file_4, media_file_5
on public.orders
for each row execute function public.media_assets_sync_order_trigger();

drop trigger if exists trg_media_assets_sync_object on public.client_objects;
create trigger trg_media_assets_sync_object
after insert or update of media_file_1, media_file_2, media_file_3
on public.client_objects
for each row execute function public.media_assets_sync_object_trigger();

drop trigger if exists trg_media_assets_sync_finance_entry on public.order_finance_entries;
create trigger trg_media_assets_sync_finance_entry
after insert or update of photo_urls
on public.order_finance_entries
for each row execute function public.media_assets_sync_finance_entry_trigger();

create or replace function public.media_assets_sync_order_map_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.media_assets_sync_order(old.order_id);
    return old;
  end if;
  perform public.media_assets_sync_order(new.order_id);
  return new;
end;
$$;

create or replace function public.media_assets_sync_object_map_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.media_assets_sync_object(old.object_id);
    return old;
  end if;
  perform public.media_assets_sync_object(new.object_id);
  return new;
end;
$$;

create or replace function public.media_assets_sync_finance_map_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.media_assets_sync_finance_entry(old.finance_entry_id);
    return old;
  end if;
  perform public.media_assets_sync_finance_entry(new.finance_entry_id);
  return new;
end;
$$;

drop trigger if exists trg_media_assets_sync_order_map on public.order_media_external_map;
create trigger trg_media_assets_sync_order_map
after insert or update or delete
on public.order_media_external_map
for each row execute function public.media_assets_sync_order_map_trigger();

drop trigger if exists trg_media_assets_sync_object_map on public.object_media_external_map;
create trigger trg_media_assets_sync_object_map
after insert or update or delete
on public.object_media_external_map
for each row execute function public.media_assets_sync_object_map_trigger();

drop trigger if exists trg_media_assets_sync_finance_map on public.finance_entry_media_external_map;
create trigger trg_media_assets_sync_finance_map
after insert or update or delete
on public.finance_entry_media_external_map
for each row execute function public.media_assets_sync_finance_map_trigger();

create or replace function public.media_assets_sync_profile_map_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.media_assets
    set status = 'deleted', deleted_at = now(), updated_at = now()
    where entity_type = old.entity_type
      and entity_id = old.entity_id
      and category = 'profile_media'
      and source_url = old.db_url;
    return old;
  end if;

  perform public.media_assets_upsert(
    new.company_id,
    new.entity_type,
    new.entity_id,
    null,
    'profile_media',
    new.db_url,
    null,
    new.provider,
    new.external_path,
    new.file_size_bytes,
    0,
    'ready',
    jsonb_build_object('source', 'profile_media_external_map')
  );
  return new;
end;
$$;

drop trigger if exists trg_media_assets_sync_profile_map on public.profile_media_external_map;
create trigger trg_media_assets_sync_profile_map
after insert or update or delete
on public.profile_media_external_map
for each row execute function public.media_assets_sync_profile_map_trigger();

do $$
declare
  r record;
begin
  for r in select id from public.orders loop
    perform public.media_assets_sync_order(r.id);
  end loop;
  for r in select id from public.client_objects loop
    perform public.media_assets_sync_object(r.id);
  end loop;
  for r in select id from public.order_finance_entries loop
    perform public.media_assets_sync_finance_entry(r.id);
  end loop;
end $$;

insert into public.media_assets (
  company_id,
  entity_type,
  entity_id,
  category,
  source_url,
  provider,
  storage_bucket,
  storage_path,
  file_size_bytes,
  sort_order,
  status,
  metadata
)
select
  m.company_id,
  m.entity_type,
  m.entity_id,
  'profile_media',
  m.db_url,
  public.media_assets_provider_from_url(m.db_url, m.provider),
  public.media_assets_storage_bucket_from_url(m.db_url),
  m.external_path,
  greatest(coalesce(m.file_size_bytes, 0), 0),
  0,
  'ready',
  jsonb_build_object('source', 'profile_media_external_map')
from public.profile_media_external_map m
on conflict (entity_type, entity_id, category, source_url)
do update set
  company_id = excluded.company_id,
  provider = excluded.provider,
  storage_bucket = coalesce(excluded.storage_bucket, public.media_assets.storage_bucket),
  storage_path = coalesce(excluded.storage_path, public.media_assets.storage_path),
  file_size_bytes = greatest(excluded.file_size_bytes, public.media_assets.file_size_bytes),
  status = 'ready',
  deleted_at = null,
  updated_at = now();

comment on table public.media_assets is
  'Unified media catalog for UI/cache/status metadata. Files remain in their existing storage providers; this table indexes metadata and lifecycle state.';

grant select on public.media_assets to authenticated;
grant all on public.media_assets to service_role;
