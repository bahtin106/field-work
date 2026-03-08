begin;

create or replace function public.find_company_client_by_phone(
  p_company_id uuid,
  p_phone text
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  middle_name text,
  full_name text,
  phone text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.first_name,
    c.last_name,
    c.middle_name,
    c.full_name,
    c.phone
  from public.clients c
  where c.company_id = p_company_id
    and public.normalize_phone_digits(c.phone) = public.normalize_phone_digits(p_phone)
  order by c.updated_at desc nulls last, c.created_at desc nulls last, c.id desc
  limit 1;
$$;

revoke all on function public.find_company_client_by_phone(uuid, text) from public;
grant execute on function public.find_company_client_by_phone(uuid, text) to service_role;

commit;
