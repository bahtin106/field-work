-- Company-scoped tags for clients and objects.
-- Includes dictionary, links, RLS, and RPC helpers for atomic tag assignment.

alter table public.companies
  add column if not exists enable_client_tags boolean not null default false,
  add column if not exists enable_object_tags boolean not null default false;

create table if not exists public.company_tags (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tag_type text not null check (tag_type in ('client', 'object')),
  value text not null,
  normalized_value text not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create unique index if not exists company_tags_company_type_norm_unique_idx
  on public.company_tags(company_id, tag_type, normalized_value);

create index if not exists company_tags_company_type_value_idx
  on public.company_tags(company_id, tag_type, value);

create table if not exists public.client_tag_links (
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  tag_id uuid not null references public.company_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (client_id, tag_id)
);

create index if not exists client_tag_links_company_idx
  on public.client_tag_links(company_id, client_id);

create table if not exists public.object_tag_links (
  company_id uuid not null references public.companies(id) on delete cascade,
  object_id uuid not null references public.client_objects(id) on delete cascade,
  tag_id uuid not null references public.company_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (object_id, tag_id)
);

create index if not exists object_tag_links_company_idx
  on public.object_tag_links(company_id, object_id);

create or replace function public.normalize_company_tag_value(p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v_value text;
begin
  v_value := regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g');
  if v_value = '' then
    return null;
  end if;
  if char_length(v_value) > 64 then
    raise exception 'tag length exceeds 64 characters'
      using errcode = '22001';
  end if;
  return v_value;
end;
$$;

create or replace function public.company_tags_sync_audit()
returns trigger
language plpgsql
as $$
declare
  v_value text;
begin
  v_value := public.normalize_company_tag_value(new.value);
  if v_value is null then
    raise exception 'tag cannot be empty' using errcode = '22023';
  end if;

  new.value := v_value;
  new.normalized_value := lower(v_value);
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);

  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_company_tags_sync_audit on public.company_tags;
create trigger trg_company_tags_sync_audit
before insert or update on public.company_tags
for each row execute function public.company_tags_sync_audit();

create or replace function public.client_tag_links_guard()
returns trigger
language plpgsql
as $$
declare
  v_client_company_id uuid;
  v_tag_company_id uuid;
  v_tag_type text;
  v_count integer;
begin
  select company_id
    into v_client_company_id
    from public.clients
   where id = new.client_id;

  if v_client_company_id is null then
    raise exception 'client % not found', new.client_id using errcode = '23503';
  end if;

  select company_id, tag_type
    into v_tag_company_id, v_tag_type
    from public.company_tags
   where id = new.tag_id;

  if v_tag_company_id is null then
    raise exception 'tag % not found', new.tag_id using errcode = '23503';
  end if;

  if v_tag_type <> 'client' then
    raise exception 'tag % is not a client tag', new.tag_id using errcode = '22023';
  end if;

  if v_client_company_id <> v_tag_company_id then
    raise exception 'tag/company mismatch' using errcode = '42501';
  end if;

  new.company_id := v_client_company_id;
  new.created_by := coalesce(new.created_by, auth.uid());
  new.created_at := coalesce(new.created_at, now());

  if tg_op = 'INSERT' then
    select count(*)::int
      into v_count
      from public.client_tag_links l
     where l.client_id = new.client_id;
  else
    select count(*)::int
      into v_count
      from public.client_tag_links l
     where l.client_id = new.client_id
       and l.tag_id <> old.tag_id;
  end if;

  if v_count >= 10 then
    raise exception 'client can have at most 10 tags' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_client_tag_links_guard on public.client_tag_links;
create trigger trg_client_tag_links_guard
before insert or update on public.client_tag_links
for each row execute function public.client_tag_links_guard();

create or replace function public.object_tag_links_guard()
returns trigger
language plpgsql
as $$
declare
  v_object_company_id uuid;
  v_tag_company_id uuid;
  v_tag_type text;
  v_count integer;
begin
  select company_id
    into v_object_company_id
    from public.client_objects
   where id = new.object_id;

  if v_object_company_id is null then
    raise exception 'object % not found', new.object_id using errcode = '23503';
  end if;

  select company_id, tag_type
    into v_tag_company_id, v_tag_type
    from public.company_tags
   where id = new.tag_id;

  if v_tag_company_id is null then
    raise exception 'tag % not found', new.tag_id using errcode = '23503';
  end if;

  if v_tag_type <> 'object' then
    raise exception 'tag % is not an object tag', new.tag_id using errcode = '22023';
  end if;

  if v_object_company_id <> v_tag_company_id then
    raise exception 'tag/company mismatch' using errcode = '42501';
  end if;

  new.company_id := v_object_company_id;
  new.created_by := coalesce(new.created_by, auth.uid());
  new.created_at := coalesce(new.created_at, now());

  if tg_op = 'INSERT' then
    select count(*)::int
      into v_count
      from public.object_tag_links l
     where l.object_id = new.object_id;
  else
    select count(*)::int
      into v_count
      from public.object_tag_links l
     where l.object_id = new.object_id
       and l.tag_id <> old.tag_id;
  end if;

  if v_count >= 10 then
    raise exception 'object can have at most 10 tags' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_object_tag_links_guard on public.object_tag_links;
create trigger trg_object_tag_links_guard
before insert or update on public.object_tag_links
for each row execute function public.object_tag_links_guard();

create or replace function public.set_client_tags(p_client_id uuid, p_tags text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_role text;
  v_has_permission boolean;
  v_enabled boolean;
  v_raw text;
  v_value text;
  v_norm text;
  v_norms text[] := '{}'::text[];
  v_values text[] := '{}'::text[];
  v_idx integer;
  v_tag_id uuid;
begin
  if p_client_id is null then
    raise exception 'client id is required' using errcode = '22023';
  end if;

  select c.company_id
    into v_company_id
    from public.clients c
   where c.id = p_client_id;

  if v_company_id is null then
    raise exception 'client % not found', p_client_id using errcode = '23503';
  end if;

  if v_company_id <> user_company_id() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  v_role := user_role();
  v_has_permission := has_app_role_permission(
    v_company_id,
    v_role,
    'canEditClients',
    clients_permission_default(v_role, 'canEditClients')
  );
  if not coalesce(v_has_permission, false) then
    raise exception 'insufficient permissions to edit client tags' using errcode = '42501';
  end if;

  select coalesce(enable_client_tags, false)
    into v_enabled
    from public.companies
   where id = v_company_id;

  if not coalesce(v_enabled, false) then
    raise exception 'client tags are disabled' using errcode = '22023';
  end if;

  foreach v_raw in array coalesce(p_tags, '{}'::text[])
  loop
    v_value := public.normalize_company_tag_value(v_raw);
    if v_value is null then
      continue;
    end if;
    v_norm := lower(v_value);

    if v_norm = any(v_norms) then
      continue;
    end if;

    if coalesce(array_length(v_norms, 1), 0) >= 10 then
      raise exception 'client can have at most 10 tags' using errcode = '22023';
    end if;

    v_norms := array_append(v_norms, v_norm);
    v_values := array_append(v_values, v_value);
  end loop;

  delete from public.client_tag_links l
   using public.company_tags t
   where l.client_id = p_client_id
     and l.tag_id = t.id
     and t.company_id = v_company_id
     and t.tag_type = 'client'
     and (
       coalesce(array_length(v_norms, 1), 0) = 0
       or not (t.normalized_value = any(v_norms))
     );

  for v_idx in 1 .. coalesce(array_length(v_norms, 1), 0)
  loop
    insert into public.company_tags (company_id, tag_type, value, normalized_value, created_by, updated_by)
    values (v_company_id, 'client', v_values[v_idx], v_norms[v_idx], auth.uid(), auth.uid())
    on conflict (company_id, tag_type, normalized_value)
    do update set
      updated_at = now(),
      updated_by = auth.uid()
    returning id into v_tag_id;

    insert into public.client_tag_links (company_id, client_id, tag_id, created_by)
    values (v_company_id, p_client_id, v_tag_id, auth.uid())
    on conflict (client_id, tag_id) do nothing;
  end loop;
end;
$$;

create or replace function public.set_object_tags(p_object_id uuid, p_tags text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_role text;
  v_has_permission boolean;
  v_enabled boolean;
  v_raw text;
  v_value text;
  v_norm text;
  v_norms text[] := '{}'::text[];
  v_values text[] := '{}'::text[];
  v_idx integer;
  v_tag_id uuid;
begin
  if p_object_id is null then
    raise exception 'object id is required' using errcode = '22023';
  end if;

  select o.company_id
    into v_company_id
    from public.client_objects o
   where o.id = p_object_id;

  if v_company_id is null then
    raise exception 'object % not found', p_object_id using errcode = '23503';
  end if;

  if v_company_id <> user_company_id() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  v_role := user_role();
  v_has_permission := has_app_role_permission(
    v_company_id,
    v_role,
    'canEditClients',
    clients_permission_default(v_role, 'canEditClients')
  );
  if not coalesce(v_has_permission, false) then
    raise exception 'insufficient permissions to edit object tags' using errcode = '42501';
  end if;

  select coalesce(enable_object_tags, false)
    into v_enabled
    from public.companies
   where id = v_company_id;

  if not coalesce(v_enabled, false) then
    raise exception 'object tags are disabled' using errcode = '22023';
  end if;

  foreach v_raw in array coalesce(p_tags, '{}'::text[])
  loop
    v_value := public.normalize_company_tag_value(v_raw);
    if v_value is null then
      continue;
    end if;
    v_norm := lower(v_value);

    if v_norm = any(v_norms) then
      continue;
    end if;

    if coalesce(array_length(v_norms, 1), 0) >= 10 then
      raise exception 'object can have at most 10 tags' using errcode = '22023';
    end if;

    v_norms := array_append(v_norms, v_norm);
    v_values := array_append(v_values, v_value);
  end loop;

  delete from public.object_tag_links l
   using public.company_tags t
   where l.object_id = p_object_id
     and l.tag_id = t.id
     and t.company_id = v_company_id
     and t.tag_type = 'object'
     and (
       coalesce(array_length(v_norms, 1), 0) = 0
       or not (t.normalized_value = any(v_norms))
     );

  for v_idx in 1 .. coalesce(array_length(v_norms, 1), 0)
  loop
    insert into public.company_tags (company_id, tag_type, value, normalized_value, created_by, updated_by)
    values (v_company_id, 'object', v_values[v_idx], v_norms[v_idx], auth.uid(), auth.uid())
    on conflict (company_id, tag_type, normalized_value)
    do update set
      updated_at = now(),
      updated_by = auth.uid()
    returning id into v_tag_id;

    insert into public.object_tag_links (company_id, object_id, tag_id, created_by)
    values (v_company_id, p_object_id, v_tag_id, auth.uid())
    on conflict (object_id, tag_id) do nothing;
  end loop;
end;
$$;

create or replace function public.search_company_tags(
  p_tag_type text,
  p_query text default '',
  p_limit integer default 12
)
returns table (
  id uuid,
  value text,
  usage_count bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_company_id uuid := user_company_id();
  v_tag_type text := lower(coalesce(p_tag_type, ''));
  v_query text := lower(public.normalize_company_tag_value(p_query));
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 30);
begin
  if v_company_id is null then
    return;
  end if;

  if v_tag_type not in ('client', 'object') then
    raise exception 'invalid tag type: %', p_tag_type using errcode = '22023';
  end if;

  if v_query is null then
    v_query := '';
  end if;

  if v_tag_type = 'client' then
    return query
      with usage_stats as (
        select l.tag_id, count(*)::bigint as c
        from public.client_tag_links l
        where l.company_id = v_company_id
        group by l.tag_id
      )
      select
        t.id,
        t.value,
        coalesce(u.c, 0)::bigint as usage_count
      from public.company_tags t
      left join usage_stats u on u.tag_id = t.id
      where t.company_id = v_company_id
        and t.tag_type = 'client'
        and (v_query = '' or t.normalized_value like v_query || '%')
      order by
        case
          when v_query = '' then 0
          when t.normalized_value = v_query then 0
          when t.normalized_value like v_query || '%' then 1
          else 2
        end,
        coalesce(u.c, 0) desc,
        t.value asc
      limit v_limit;

    return;
  end if;

  return query
    with usage_stats as (
      select l.tag_id, count(*)::bigint as c
      from public.object_tag_links l
      where l.company_id = v_company_id
      group by l.tag_id
    )
    select
      t.id,
      t.value,
      coalesce(u.c, 0)::bigint as usage_count
    from public.company_tags t
    left join usage_stats u on u.tag_id = t.id
    where t.company_id = v_company_id
      and t.tag_type = 'object'
      and (v_query = '' or t.normalized_value like v_query || '%')
    order by
      case
        when v_query = '' then 0
        when t.normalized_value = v_query then 0
        when t.normalized_value like v_query || '%' then 1
        else 2
      end,
      coalesce(u.c, 0) desc,
      t.value asc
    limit v_limit;
end;
$$;

alter table public.company_tags enable row level security;
alter table public.client_tag_links enable row level security;
alter table public.object_tag_links enable row level security;

drop policy if exists company_tags_select_company on public.company_tags;
create policy company_tags_select_company
on public.company_tags
for select
to authenticated
using (
  company_id = user_company_id()
);

drop policy if exists company_tags_insert_company on public.company_tags;
create policy company_tags_insert_company
on public.company_tags
for insert
to authenticated
with check (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
);

drop policy if exists company_tags_update_company on public.company_tags;
create policy company_tags_update_company
on public.company_tags
for update
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
)
with check (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
);

drop policy if exists company_tags_delete_company on public.company_tags;
create policy company_tags_delete_company
on public.company_tags
for delete
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
);

drop policy if exists client_tag_links_select_company on public.client_tag_links;
create policy client_tag_links_select_company
on public.client_tag_links
for select
to authenticated
using (
  company_id = user_company_id()
);

drop policy if exists client_tag_links_insert_company on public.client_tag_links;
create policy client_tag_links_insert_company
on public.client_tag_links
for insert
to authenticated
with check (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
);

drop policy if exists client_tag_links_update_company on public.client_tag_links;
create policy client_tag_links_update_company
on public.client_tag_links
for update
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
)
with check (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
);

drop policy if exists client_tag_links_delete_company on public.client_tag_links;
create policy client_tag_links_delete_company
on public.client_tag_links
for delete
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
);

drop policy if exists object_tag_links_select_company on public.object_tag_links;
create policy object_tag_links_select_company
on public.object_tag_links
for select
to authenticated
using (
  company_id = user_company_id()
);

drop policy if exists object_tag_links_insert_company on public.object_tag_links;
create policy object_tag_links_insert_company
on public.object_tag_links
for insert
to authenticated
with check (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
);

drop policy if exists object_tag_links_update_company on public.object_tag_links;
create policy object_tag_links_update_company
on public.object_tag_links
for update
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
)
with check (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
);

drop policy if exists object_tag_links_delete_company on public.object_tag_links;
create policy object_tag_links_delete_company
on public.object_tag_links
for delete
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
);

grant select, insert, update, delete on public.company_tags to authenticated;
grant select, insert, update, delete on public.client_tag_links to authenticated;
grant select, insert, update, delete on public.object_tag_links to authenticated;

grant execute on function public.set_client_tags(uuid, text[]) to authenticated;
grant execute on function public.set_object_tags(uuid, text[]) to authenticated;
grant execute on function public.search_company_tags(text, text, integer) to authenticated;

