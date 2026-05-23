create or replace function public.current_user_has_app_permission(
  p_key text,
  p_default boolean default false
)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select case
    when coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then true
    else public.has_app_role_permission(
      public.user_company_id(),
      public.user_role(),
      p_key,
      coalesce(p_default, false)
    )
  end;
$$;

comment on function public.current_user_has_app_permission(text, boolean) is
  'Checks the current authenticated user app permission in app_role_permissions with a caller-provided default.';

create or replace function public.clients_permission_default(p_role text, p_key text)
returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'public', 'auth', 'storage', 'extensions'
as $$
  select case
    when p_key in ('canViewClients', 'canViewClientPhones') then true
    when lower(coalesce(p_role, '')) in ('admin', 'dispatcher') then true
    when lower(coalesce(p_role, '')) = 'worker' then p_key in ('canCreateClients')
    else false
  end;
$$;

create or replace function public.object_permission_default(p_role text, p_key text)
returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'public', 'auth', 'storage', 'extensions'
as $$
  select case
    when p_key in ('canViewObjects', 'canViewObjectPhones') then true
    when lower(coalesce(p_role, '')) in ('admin', 'dispatcher') then true
    when lower(coalesce(p_role, '')) = 'worker' then p_key in ('canCreateObjects')
    else false
  end;
$$;

insert into public.app_role_permissions(company_id, role, key, value)
select c.id, r.role, p.key, true
from public.companies c
cross join (values ('admin'), ('dispatcher'), ('worker')) as r(role)
cross join (values ('canViewClientPhones'), ('canViewObjectPhones')) as p(key)
on conflict (company_id, role, key) do nothing;

notify pgrst, 'reload schema';
