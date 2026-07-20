begin;

create table if not exists public.trash_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  entity_type text not null check (entity_type in ('order', 'client', 'client_object', 'media')),
  entity_id uuid not null,
  deletion_batch_id uuid not null,
  parent_entry_id uuid null references public.trash_entries(id) on delete cascade,
  is_root boolean not null default true,
  title text not null,
  subtitle text null,
  thumbnail_url text null,
  record_data jsonb not null,
  access_user_ids uuid[] not null default '{}'::uuid[],
  deleted_by uuid null references auth.users(id) on delete set null,
  deleted_at timestamptz not null default now(),
  purge_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  constraint trash_entries_entity_unique unique (entity_type, entity_id)
);

create index if not exists trash_entries_company_purge_idx
  on public.trash_entries (company_id, purge_at, deleted_at desc);
create index if not exists trash_entries_access_users_idx
  on public.trash_entries using gin (access_user_ids);
create index if not exists trash_entries_batch_idx
  on public.trash_entries (deletion_batch_id);

alter table public.trash_entries enable row level security;
revoke all on public.trash_entries from public, anon, authenticated;
grant all on public.trash_entries to service_role;

create or replace function public.trash_permission_default(p_role text, p_key text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case lower(coalesce(p_role, ''))
    when 'admin' then p_key in ('canViewTrash', 'canRestoreTrash', 'canPurgeTrash')
    when 'dispatcher' then p_key in ('canViewTrash', 'canRestoreTrash')
    else false
  end;
$$;

insert into public.app_role_permissions (company_id, role, key, value)
select c.id, d.role, d.key, d.value
from public.companies c
cross join (
  values
    ('admin'::text, 'canViewTrash'::text, true),
    ('admin', 'canRestoreTrash', true),
    ('admin', 'canPurgeTrash', true),
    ('dispatcher', 'canViewTrash', true),
    ('dispatcher', 'canRestoreTrash', true),
    ('dispatcher', 'canPurgeTrash', false),
    ('worker', 'canViewTrash', false),
    ('worker', 'canRestoreTrash', false),
    ('worker', 'canPurgeTrash', false)
) as d(role, key, value)
on conflict (company_id, role, key) do nothing;

create or replace function public.current_user_has_trash_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select case
    when coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then true
    when auth.uid() is null then false
    else public.current_user_has_app_permission(
      p_key,
      public.trash_permission_default(public.user_role(), p_key)
    )
  end;
$$;

revoke all on function public.current_user_has_trash_permission(text) from public, anon;
grant execute on function public.current_user_has_trash_permission(text) to authenticated, service_role;

create or replace function public.trash_access_snapshot(
  p_company_id uuid,
  p_entity_type text,
  p_record jsonb
)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select coalesce(array_agg(p.id), '{}'::uuid[])
  from public.profiles p
  where p.company_id = p_company_id
    and case p_entity_type
      when 'order' then (
        coalesce(
        (
          select arp.value
          from public.app_role_permissions arp
          where arp.company_id = p_company_id
            and arp.role = lower(coalesce(p.role, ''))
            and arp.key = 'canViewAllOrders'
          limit 1
        ),
        public.order_permission_default(p.role, 'canViewAllOrders')
        )
        or p.id = nullif(p_record ->> 'assigned_to', '')::uuid
        or p.id = nullif(p_record ->> 'created_by_user_id', '')::uuid
        or (
          p_record ->> 'status' = 'feed'
          and exists (
            select 1 from public.companies c
            where c.id = p_company_id
              and c.use_order_statuses = true
              and c.feed_status_enabled = true
          )
        )
      )
      when 'client' then coalesce(
        (
          select arp.value
          from public.app_role_permissions arp
          where arp.company_id = p_company_id
            and arp.role = lower(coalesce(p.role, ''))
            and arp.key = 'canViewClients'
          limit 1
        ),
        public.clients_permission_default(p.role, 'canViewClients')
      )
      when 'client_object' then coalesce(
        (
          select arp.value
          from public.app_role_permissions arp
          where arp.company_id = p_company_id
            and arp.role = lower(coalesce(p.role, ''))
            and arp.key = 'canViewObjects'
          limit 1
        ),
        public.object_permission_default(p.role, 'canViewObjects')
      )
      else false
    end;
$$;

revoke all on function public.trash_access_snapshot(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.trash_access_snapshot(uuid, text, jsonb) to service_role;

create or replace function public.capture_deleted_entity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_record jsonb := to_jsonb(old);
  v_company_id uuid := nullif(v_record ->> 'company_id', '')::uuid;
  v_entity_id uuid := nullif(v_record ->> 'id', '')::uuid;
  v_entity_type text;
  v_batch_id uuid := gen_random_uuid();
  v_root_id uuid := gen_random_uuid();
  v_title text;
  v_subtitle text;
  v_thumbnail text;
  v_access uuid[];
  v_child record;
  v_child_data jsonb;
  v_child_access uuid[];
begin
  if current_setting('app.trash_hard_delete', true) = 'on' then
    return old;
  end if;

  v_entity_type := case tg_table_name
    when 'orders' then 'order'
    when 'clients' then 'client'
    when 'client_objects' then 'client_object'
    else null
  end;
  if v_entity_type is null or v_company_id is null or v_entity_id is null then
    raise exception 'Unsupported trash entity: %', tg_table_name using errcode = '22023';
  end if;

  if v_entity_type = 'client' and exists (
    select 1
    from public.orders o
    where o.company_id = v_company_id
      and (
        o.client_id = v_entity_id
        or o.object_id in (
          select co.id from public.client_objects co
          where co.company_id = v_company_id and co.client_id = v_entity_id
        )
      )
  ) then
    raise exception 'Client has active requests' using errcode = '23503';
  end if;

  v_title := case v_entity_type
    when 'order' then coalesce(nullif(v_record ->> 'title', ''), 'Заявка')
    when 'client' then coalesce(
      nullif(trim(concat_ws(' ', v_record ->> 'last_name', v_record ->> 'first_name', v_record ->> 'middle_name')), ''),
      nullif(v_record ->> 'full_name', ''),
      'Клиент'
    )
    else coalesce(nullif(v_record ->> 'name', ''), 'Объект')
  end;
  v_subtitle := case v_entity_type
    when 'order' then nullif(concat_ws(', ', v_record ->> 'city', v_record ->> 'street', v_record ->> 'house'), '')
    when 'client' then nullif(v_record ->> 'email', '')
    else nullif(concat_ws(', ', v_record ->> 'city', v_record ->> 'street', v_record ->> 'house'), '')
  end;
  v_thumbnail := case v_entity_type
    when 'client' then nullif(v_record ->> 'avatar_url', '')
    when 'client_object' then nullif(v_record ->> 'photo_url', '')
    else null
  end;
  v_access := public.trash_access_snapshot(v_company_id, v_entity_type, v_record);
  if auth.uid() is not null and not (auth.uid() = any(v_access)) then
    v_access := array_append(v_access, auth.uid());
  end if;

  insert into public.trash_entries (
    id, company_id, entity_type, entity_id, deletion_batch_id, is_root,
    title, subtitle, thumbnail_url, record_data, access_user_ids, deleted_by
  ) values (
    v_root_id, v_company_id, v_entity_type, v_entity_id, v_batch_id, true,
    v_title, v_subtitle, v_thumbnail, v_record, v_access, auth.uid()
  )
  on conflict (entity_type, entity_id) do nothing;

  if v_entity_type = 'client' then
    for v_child in
      select o.* from public.client_objects o
      where o.client_id = v_entity_id and o.company_id = v_company_id
    loop
      v_child_data := to_jsonb(v_child);
      v_child_access := public.trash_access_snapshot(v_company_id, 'client_object', v_child_data);
      if auth.uid() is not null and not (auth.uid() = any(v_child_access)) then
        v_child_access := array_append(v_child_access, auth.uid());
      end if;
      insert into public.trash_entries (
        company_id, entity_type, entity_id, deletion_batch_id, parent_entry_id, is_root,
        title, subtitle, thumbnail_url, record_data, access_user_ids, deleted_by
      ) values (
        v_company_id, 'client_object', v_child.id, v_batch_id, v_root_id, false,
        coalesce(nullif(v_child_data ->> 'name', ''), 'Объект'),
        nullif(concat_ws(', ', v_child_data ->> 'city', v_child_data ->> 'street', v_child_data ->> 'house'), ''),
        nullif(v_child_data ->> 'photo_url', ''), v_child_data, v_child_access, auth.uid()
      )
      on conflict (entity_type, entity_id) do nothing;
    end loop;
  end if;

  return null;
end;
$$;

drop trigger if exists orders_capture_delete_to_trash on public.orders;
create trigger orders_capture_delete_to_trash
before delete on public.orders
for each row execute function public.capture_deleted_entity();

drop trigger if exists clients_capture_delete_to_trash on public.clients;
create trigger clients_capture_delete_to_trash
before delete on public.clients
for each row execute function public.capture_deleted_entity();

drop trigger if exists client_objects_capture_delete_to_trash on public.client_objects;
create trigger client_objects_capture_delete_to_trash
before delete on public.client_objects
for each row execute function public.capture_deleted_entity();

create or replace function public.guard_trashed_entity_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_entity_type text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return new;
  end if;
  v_entity_type := case tg_table_name
    when 'orders' then 'order'
    when 'clients' then 'client'
    when 'client_objects' then 'client_object'
    else null
  end;
  if exists (
    select 1 from public.trash_entries t
    where t.entity_type = v_entity_type and t.entity_id = old.id
  ) then
    -- Deleting company dictionaries must still be able to detach a now-invalid
    -- reference. The user-visible snapshot remains immutable in record_data.
    if v_entity_type = 'order'
       and (to_jsonb(old) - array['work_type_id','department_id','updated_at','updated_by'])
           = (to_jsonb(new) - array['work_type_id','department_id','updated_at','updated_by'])
       and (new.work_type_id is null or new.work_type_id is not distinct from old.work_type_id)
       and (new.department_id is null or new.department_id is not distinct from old.department_id) then
      return new;
    end if;
    raise exception 'Deleted entities are read-only' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_guard_trashed_update on public.orders;
create trigger orders_guard_trashed_update before update on public.orders
for each row execute function public.guard_trashed_entity_mutation();
drop trigger if exists clients_guard_trashed_update on public.clients;
create trigger clients_guard_trashed_update before update on public.clients
for each row execute function public.guard_trashed_entity_mutation();
drop trigger if exists client_objects_guard_trashed_update on public.client_objects;
create trigger client_objects_guard_trashed_update before update on public.client_objects
for each row execute function public.guard_trashed_entity_mutation();

alter view if exists public.clients_secure rename to clients_secure_including_trash_v1;
create view public.clients_secure with (security_barrier = true) as
select source.*
from public.clients_secure_including_trash_v1 source
where not exists (
  select 1 from public.trash_entries t
  where t.entity_type = 'client' and t.entity_id = source.id
);

alter view if exists public.client_objects_secure rename to client_objects_secure_including_trash_v1;
create view public.client_objects_secure with (security_barrier = true) as
select source.*
from public.client_objects_secure_including_trash_v1 source
where not exists (
  select 1 from public.trash_entries t
  where t.entity_type = 'client_object' and t.entity_id = source.id
);

alter view if exists public.orders_accessible rename to orders_accessible_including_trash_v1;
create view public.orders_accessible with (security_barrier = true) as
select source.*
from public.orders_accessible_including_trash_v1 source
where not exists (
  select 1 from public.trash_entries t
  where t.entity_type = 'order' and t.entity_id = source.id
);

grant select on public.clients_secure, public.client_objects_secure, public.orders_accessible
  to authenticated, service_role;

create or replace function public.list_trash_items(
  p_search text default null,
  p_entity_type text default null,
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
    and (p_entity_type is null or p_entity_type = '' or t.entity_type = p_entity_type)
    and (
      p_search is null or btrim(p_search) = ''
      or t.title ilike '%' || btrim(p_search) || '%'
      or coalesce(t.subtitle, '') ilike '%' || btrim(p_search) || '%'
    )
  order by
    case when p_sort = 'deleted_desc' then t.deleted_at end desc,
    case when p_sort = 'title' then lower(t.title) end asc,
    t.purge_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create or replace function public.get_trash_item(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v public.trash_entries;
  v_data jsonb;
begin
  if not public.current_user_has_trash_permission('canViewTrash') then
    raise exception 'Trash access denied' using errcode = '42501';
  end if;
  select * into v from public.trash_entries t
  where t.id = p_id and t.is_root
    and t.company_id = public.user_company_id()
    and auth.uid() = any(t.access_user_ids);
  if not found then raise exception 'Trash item not found' using errcode = 'P0002'; end if;

  v_data := v.record_data;
  if v.entity_type = 'client' and not public.current_user_has_app_permission(
    'canViewClientPhones', public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then
    v_data := v_data - array['phone','additional_phone_1','additional_phone_2','additional_phone_3'];
  elsif v.entity_type = 'client_object' and not public.current_user_has_app_permission(
    'canViewObjectPhones', public.object_permission_default(public.user_role(), 'canViewObjectPhones')
  ) then
    v_data := v_data - array['additional_phone_1','additional_phone_2','additional_phone_3'];
  elsif v.entity_type = 'order' then
    if not public.current_user_has_app_permission(
      'canViewOrderPhotos', public.order_permission_default(public.user_role(), 'canViewOrderPhotos')
    ) then
      v_data := v_data - array['media_file_1','media_file_2','media_file_3','media_file_4','media_file_5'];
    end if;
    if not public.current_user_has_app_permission(
      'canViewFinanceAll', public.finance_permission_default(public.user_role(), 'canViewFinanceAll')
    ) then
      v_data := v_data - array['start_price','finance_income_total','finance_expense_total','finance_discount_total','finance_gross_total','finance_net_total'];
    end if;
  end if;

  return jsonb_build_object(
    'id', v.id, 'entity_type', v.entity_type, 'entity_id', v.entity_id,
    'title', v.title, 'subtitle', v.subtitle, 'thumbnail_url', v.thumbnail_url,
    'deleted_at', v.deleted_at, 'purge_at', v.purge_at,
    'child_count', (select count(*) from public.trash_entries c where c.parent_entry_id = v.id),
    'data', v_data
  );
end;
$$;

create or replace function public.restore_trash_item(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v public.trash_entries;
begin
  if not public.current_user_has_trash_permission('canRestoreTrash') then
    raise exception 'Trash restore denied' using errcode = '42501';
  end if;
  select * into v from public.trash_entries t
  where t.id = p_id and t.is_root
    and t.company_id = public.user_company_id()
    and auth.uid() = any(t.access_user_ids)
  for update;
  if not found then raise exception 'Trash item not found' using errcode = 'P0002'; end if;
  delete from public.trash_entries where deletion_batch_id = v.deletion_batch_id;
  return true;
end;
$$;

create or replace function public.purge_trash_item(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v public.trash_entries;
begin
  if not public.current_user_has_trash_permission('canPurgeTrash') then
    raise exception 'Trash purge denied' using errcode = '42501';
  end if;
  select * into v from public.trash_entries t
  where t.id = p_id and t.is_root and t.company_id = public.user_company_id()
    and auth.uid() = any(t.access_user_ids)
  for update;
  if not found then raise exception 'Trash item not found' using errcode = 'P0002'; end if;
  perform set_config('app.trash_hard_delete', 'on', true);
  if v.entity_type = 'order' then delete from public.orders where id = v.entity_id and company_id = v.company_id;
  elsif v.entity_type = 'client' then delete from public.clients where id = v.entity_id and company_id = v.company_id;
  elsif v.entity_type = 'client_object' then delete from public.client_objects where id = v.entity_id and company_id = v.company_id;
  end if;
  delete from public.trash_entries where deletion_batch_id = v.deletion_batch_id;
  return true;
end;
$$;

create or replace function public.purge_expired_trash()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v public.trash_entries; v_count integer := 0;
begin
  perform set_config('app.trash_hard_delete', 'on', true);
  for v in select * from public.trash_entries where is_root and purge_at <= now() order by purge_at for update skip locked
  loop
    if v.entity_type = 'order' then delete from public.orders where id = v.entity_id and company_id = v.company_id;
    elsif v.entity_type = 'client' then delete from public.clients where id = v.entity_id and company_id = v.company_id;
    elsif v.entity_type = 'client_object' then delete from public.client_objects where id = v.entity_id and company_id = v.company_id;
    end if;
    delete from public.trash_entries where deletion_batch_id = v.deletion_batch_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.list_trash_items(text,text,text,integer,integer) from public, anon;
revoke all on function public.get_trash_item(uuid) from public, anon;
revoke all on function public.restore_trash_item(uuid) from public, anon;
revoke all on function public.purge_trash_item(uuid) from public, anon;
revoke all on function public.purge_expired_trash() from public, anon, authenticated;
grant execute on function public.list_trash_items(text,text,text,integer,integer) to authenticated, service_role;
grant execute on function public.get_trash_item(uuid) to authenticated, service_role;
grant execute on function public.restore_trash_item(uuid) to authenticated, service_role;
grant execute on function public.purge_trash_item(uuid) to authenticated, service_role;
grant execute on function public.purge_expired_trash() to service_role;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'purge-expired-company-trash';
    perform cron.schedule(
      'purge-expired-company-trash',
      '17 * * * *',
      'select public.purge_expired_trash();'
    );
  end if;
exception when insufficient_privilege or undefined_function or undefined_table then
  raise notice 'pg_cron unavailable; schedule public.purge_expired_trash() from the server worker';
end;
$$;

notify pgrst, 'reload schema';
commit;
