begin;

create or replace function public.admin_list_companies(
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
declare
  v_search text := nullif(btrim(p_search), '');
begin
  perform public.admin_assert_super_admin();

  -- Keep the common unfiltered load as cheap as before: calculate aggregates only
  -- for the requested page. A full search document is built only when needed.
  if v_search is null then
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
    order by coalesce(c.name, c.id::text)
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0));

    return;
  end if;

  return query
  with company_rows as materialized (
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
  )
  select
    row.company_id,
    row.name,
    row.timezone,
    row.currency,
    row.employees_count,
    row.plan_code,
    row.subscription_status,
    row.current_period_end,
    row.updated_at,
    row.admin_name,
    row.admin_email
  from company_rows row
  where v_search is null
    or concat_ws(
      ' ',
      row.company_id::text,
      row.name,
      row.timezone,
      row.currency,
      row.employees_count::text,
      row.plan_code,
      row.subscription_status,
      case row.subscription_status
        when 'active' then 'активна активная active subscription active'
        else 'истекла закончилась просрочена expired subscription expired'
      end,
      case
        when row.admin_name is null then 'администратор не назначен administrator not assigned'
        else row.admin_name
      end,
      row.admin_email,
      case
        when row.current_period_end is null then 'подписка не оформлена subscription not configured'
        else to_char(row.current_period_end at time zone 'Europe/Moscow', 'DD.MM.YYYY')
      end,
      case
        when row.current_period_end is null then null
        when row.subscription_status = 'active'
          then 'подписка активна до ' || to_char(row.current_period_end at time zone 'Europe/Moscow', 'DD.MM.YYYY')
        else 'подписка истекла ' || to_char(row.current_period_end at time zone 'Europe/Moscow', 'DD.MM.YYYY')
      end,
      case
        when row.current_period_end is null then null
        when row.subscription_status = 'active'
          then 'subscription active until ' || to_char(row.current_period_end at time zone 'Europe/Moscow', 'MM/DD/YYYY')
        else 'subscription expired on ' || to_char(row.current_period_end at time zone 'Europe/Moscow', 'MM/DD/YYYY')
      end,
      case
        when row.current_period_end is null then null
        else to_char(row.current_period_end at time zone 'Europe/Moscow', 'MM/DD/YYYY')
      end,
      case
        when row.current_period_end is null then null
        else to_char(row.current_period_end at time zone 'Europe/Moscow', 'YYYY-MM-DD')
      end,
      to_char(row.updated_at at time zone 'Europe/Moscow', 'DD.MM.YYYY'),
      to_char(row.updated_at at time zone 'Europe/Moscow', 'MM/DD/YYYY'),
      to_char(row.updated_at at time zone 'Europe/Moscow', 'YYYY-MM-DD')
    ) ilike ('%' || v_search || '%')
  order by coalesce(row.name, row.company_id::text)
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

revoke all on function public.admin_list_companies(text, integer, integer) from public, anon;
grant execute on function public.admin_list_companies(text, integer, integer) to authenticated, service_role;

commit;
