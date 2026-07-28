begin;

drop function if exists public.admin_list_companies(text, integer, integer);

create function public.admin_list_companies(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  company_id uuid,
  name text,
  timezone text,
  currency text,
  employees_count integer,
  plan_code text,
  subscription_status text,
  current_period_end timestamptz,
  updated_at timestamptz,
  admin_name text,
  admin_email text
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.admin_assert_super_admin();

  return query
  select
    c.id as company_id,
    c.name,
    c.timezone,
    c.currency,
    public.admin_company_employees_count(c.id) as employees_count,
    'subscription_base'::text as plan_code,
    case
      when cs.current_period_end is not null and cs.current_period_end >= now() then 'active'
      else 'expired'
    end as subscription_status,
    cs.current_period_end,
    c.updated_at,
    company_admin.admin_name,
    company_admin.admin_email
  from public.companies c
  left join public.company_subscriptions cs on cs.company_id = c.id
  left join lateral (
    select
      coalesce(
        nullif(btrim(p.full_name), ''),
        nullif(concat_ws(
          ' ',
          nullif(btrim(p.last_name), ''),
          nullif(btrim(p.first_name), ''),
          nullif(btrim(p.middle_name), '')
        ), '')
      ) as admin_name,
      nullif(btrim(p.email), '') as admin_email
    from public.profiles p
    where p.company_id = c.id
      and lower(coalesce(p.role, '')) = 'admin'
    order by
      case when p.id = c.owner_id then 0 else 1 end,
      p.created_at asc nulls last,
      p.id
    limit 1
  ) company_admin on true
  where
    coalesce(p_search, '') = ''
    or coalesce(c.name, '') ilike ('%' || p_search || '%')
    or c.id::text ilike ('%' || p_search || '%')
  order by coalesce(c.name, c.id::text)
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

alter function public.admin_list_companies(text, integer, integer) owner to supabase_admin;
revoke all on function public.admin_list_companies(text, integer, integer) from public, anon;
grant execute on function public.admin_list_companies(text, integer, integer) to authenticated, service_role;

commit;
