begin;

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
  v_order_id uuid;
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

  if p_recalc_existing then
    update public.companies
    set recalc_in_progress = true
    where id = p_company_id;

    perform set_config('app.currency_recalc', '1', true);

    select use_work_types
      into v_use_work_types
    from public.companies
    where id = p_company_id;

    if v_use_work_types then
      select exists(
        select 1
        from public.orders o
        where o.company_id = p_company_id
          and o.work_type_id is null
        limit 1
      )
      into v_missing_worktype;

      if v_missing_worktype then
        raise exception 'Cannot recalc: work_type_id is required for some orders (company.use_work_types = true). Assign work types first.';
      end if;
    end if;

    update public.orders o
    set
      start_price = case
        when o.start_price is null then null
        else round(o.start_price * p_rate, 2)
      end,
      currency = p_new_currency
    where o.company_id = p_company_id;

    update public.order_finance_entries e
    set
      input_amount = case
        when lower(coalesce(e.calc_mode, 'fixed')) = 'fixed' and e.input_amount is not null
          then round(e.input_amount * p_rate, 2)
        else e.input_amount
      end,
      updated_at = now(),
      updated_by = coalesce(auth.uid(), e.updated_by)
    where exists (
      select 1
      from public.orders o
      where o.id = e.order_id
        and o.company_id = p_company_id
    );

    for v_order_id in
      select o.id
      from public.orders o
      where o.company_id = p_company_id
    loop
      perform public.recalculate_order_finance_totals(v_order_id);
    end loop;
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

grant execute on function public.company_set_currency(uuid, text, numeric, boolean) to authenticated;

commit;
