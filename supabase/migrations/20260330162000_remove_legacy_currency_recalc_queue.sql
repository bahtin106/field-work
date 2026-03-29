-- Remove legacy currency recalculation queue infrastructure.
-- Current product uses a single currency now; keep RPC compatibility without queue tables/workers.

-- 1) Replace company_set_currency overloads so none depend on finance_currency_recalc_jobs/recalc_job_id.
drop function if exists public.company_set_currency(uuid, text, boolean, numeric);
drop function if exists public.company_set_currency(uuid, text, numeric, boolean);

create or replace function public.company_set_currency(
  p_company_id uuid,
  p_new_currency text,
  p_rate numeric,
  p_recalc_existing boolean default true
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_use_work_types boolean;
  v_missing_worktype boolean;
begin
  if not is_admin() or user_company_id() is distinct from p_company_id then
    raise exception 'forbidden';
  end if;

  if p_new_currency not in ('RUB', 'USD', 'EUR') then
    raise exception 'Unsupported currency: %', p_new_currency;
  end if;

  if p_recalc_existing and (p_rate is null or p_rate <= 0) then
    raise exception 'Rate must be > 0 for recalculation';
  end if;

  update public.companies
  set recalc_in_progress = true
  where id = p_company_id;

  perform set_config('app.currency_recalc', '1', true);

  select use_work_types into v_use_work_types
  from public.companies
  where id = p_company_id;

  if p_recalc_existing then
    if v_use_work_types then
      select exists(
        select 1 from public.orders o
        where o.company_id = p_company_id and o.work_type_id is null
        limit 1
      ) into v_missing_worktype;

      if v_missing_worktype then
        raise exception 'Cannot recalc: work_type_id is required for some orders (company.use_work_types = true). Assign work types first.';
      end if;
    end if;

    update public.orders o
    set
      price = case when o.price is null then null else round(o.price * p_rate, 2) end,
      total_amount = case when o.total_amount is null then null else round(o.total_amount * p_rate, 2) end,
      discount = case when o.discount is null then null else round(o.discount * p_rate, 2) end,
      currency = p_new_currency
    where o.company_id = p_company_id;
  else
    update public.orders o
    set currency = p_new_currency
    where o.company_id = p_company_id;
  end if;

  update public.companies
  set
    currency = p_new_currency,
    currency_rate = case when p_recalc_existing then p_rate else currency_rate end,
    currency_rate_updated_at = case when p_recalc_existing then now() else currency_rate_updated_at end,
    recalc_in_progress = false
  where id = p_company_id;
exception when others then
  update public.companies
  set recalc_in_progress = false
  where id = p_company_id;
  raise;
end
$function$;

create or replace function public.company_set_currency(
  p_company_id uuid,
  p_currency text,
  p_recalc_existing boolean default false,
  p_currency_rate numeric default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.company_set_currency(
    p_company_id := p_company_id,
    p_new_currency := p_currency,
    p_rate := p_currency_rate,
    p_recalc_existing := p_recalc_existing
  );
end
$function$;

grant execute on function public.company_set_currency(uuid, text, numeric, boolean) to authenticated;
grant execute on function public.company_set_currency(uuid, text, boolean, numeric) to authenticated;

-- 2) Drop queue artifacts.
drop table if exists public.finance_currency_recalc_jobs;
alter table if exists public.companies drop column if exists recalc_job_id;

