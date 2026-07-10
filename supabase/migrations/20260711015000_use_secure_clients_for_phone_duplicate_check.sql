begin;

create or replace function public.find_client_by_primary_phone(
  p_phone text,
  p_exclude_client_id uuid default null
)
returns table(
  id uuid,
  first_name text,
  last_name text,
  middle_name text,
  full_name text,
  phone text
)
language plpgsql
stable
set search_path = pg_catalog, public, auth, storage, extensions
as $$
declare
  v_company_id uuid := public.user_company_id();
begin
  if v_company_id is null then
    return;
  end if;

  return query
  select
    c.id,
    c.first_name,
    c.last_name,
    c.middle_name,
    c.full_name,
    c.phone
  from public.clients_secure c
  where c.company_id = v_company_id
    and public.has_app_role_permission(
      c.company_id,
      public.user_role(),
      'canViewClients',
      public.clients_permission_default(public.user_role(), 'canViewClients')
    )
    and public.normalize_phone_digits(c.phone) = public.normalize_phone_digits(p_phone)
    and (p_exclude_client_id is null or c.id <> p_exclude_client_id)
  order by c.updated_at desc nulls last, c.created_at desc nulls last, c.id desc
  limit 1;
end;
$$;

commit;
