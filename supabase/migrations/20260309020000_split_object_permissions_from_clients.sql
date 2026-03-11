create or replace function public.object_permission_default(p_role text, p_key text)
returns boolean
language sql
immutable
as $$
  select case
    when lower(coalesce(p_role, '')) in ('admin', 'dispatcher') then true
    when lower(coalesce(p_role, '')) = 'worker' then p_key = 'canViewObjects'
    else false
  end;
$$;

with companies_with_access_settings as (
  select distinct company_id
  from public.app_role_permissions
),
role_defaults as (
  select *
  from (
    values
      ('canViewObjects'::text, 'canViewClients'::text),
      ('canCreateObjects'::text, 'canCreateClients'::text),
      ('canEditObjects'::text, 'canEditClients'::text),
      ('canDeleteObjects'::text, 'canDeleteClients'::text)
  ) as t(object_key, client_key)
),
roles as (
  select *
  from (
    values ('admin'::text), ('dispatcher'::text), ('worker'::text)
  ) as t(role)
)
insert into public.app_role_permissions (company_id, role, key, value)
select
  c.company_id,
  r.role,
  d.object_key,
  coalesce(
    (
      select p.value
      from public.app_role_permissions p
      where p.company_id = c.company_id
        and p.role = r.role
        and p.key = d.client_key
      limit 1
    ),
    public.object_permission_default(r.role, d.object_key)
  ) as value
from companies_with_access_settings c
cross join roles r
cross join role_defaults d
where not exists (
  select 1
  from public.app_role_permissions p
  where p.company_id = c.company_id
    and p.role = r.role
    and p.key = d.object_key
)
on conflict (company_id, role, key) do nothing;

drop policy if exists client_objects_select_company on public.client_objects;
create policy client_objects_select_company
on public.client_objects
for select
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canViewObjects',
    object_permission_default(user_role(), 'canViewObjects')
  )
);

drop policy if exists client_objects_insert_company on public.client_objects;
create policy client_objects_insert_company
on public.client_objects
for insert
to authenticated
with check (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canCreateObjects',
    object_permission_default(user_role(), 'canCreateObjects')
  )
);

drop policy if exists client_objects_update_company on public.client_objects;
create policy client_objects_update_company
on public.client_objects
for update
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditObjects',
    object_permission_default(user_role(), 'canEditObjects')
  )
)
with check (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditObjects',
    object_permission_default(user_role(), 'canEditObjects')
  )
);

drop policy if exists client_objects_delete_company on public.client_objects;
create policy client_objects_delete_company
on public.client_objects
for delete
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canDeleteObjects',
    object_permission_default(user_role(), 'canDeleteObjects')
  )
);

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
  v_tag text;
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
    raise exception 'object % is outside of your company', p_object_id using errcode = '42501';
  end if;

  v_role := user_role();
  v_has_permission := has_app_role_permission(
    v_company_id,
    v_role,
    'canEditObjects',
    object_permission_default(v_role, 'canEditObjects')
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
    v_tag := v_values[v_idx];
    insert into public.company_tags (company_id, tag_type, value, normalized_value, created_by, updated_by)
    values (v_company_id, 'object', v_tag, v_norms[v_idx], auth.uid(), auth.uid())
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

drop policy if exists object_tag_links_select_company on public.object_tag_links;
create policy object_tag_links_select_company
on public.object_tag_links
for select
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canViewObjects',
    object_permission_default(user_role(), 'canViewObjects')
  )
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
    'canEditObjects',
    object_permission_default(user_role(), 'canEditObjects')
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
    'canEditObjects',
    object_permission_default(user_role(), 'canEditObjects')
  )
)
with check (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditObjects',
    object_permission_default(user_role(), 'canEditObjects')
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
    'canEditObjects',
    object_permission_default(user_role(), 'canEditObjects')
  )
);
