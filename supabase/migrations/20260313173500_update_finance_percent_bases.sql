begin;

update public.company_finance_rules
set percent_base = 'gross_after_discount'
where percent_base = 'net_before_expense';

update public.order_finance_entries
set percent_base = 'gross_after_discount'
where percent_base = 'net_before_expense';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'company_finance_rules_percent_base_check'
  ) then
    alter table public.company_finance_rules
      drop constraint company_finance_rules_percent_base_check;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = 'order_finance_entries_percent_base_check'
  ) then
    alter table public.order_finance_entries
      drop constraint order_finance_entries_percent_base_check;
  end if;
end
$$;

alter table public.company_finance_rules
  alter column percent_base set default 'base_price';

alter table public.order_finance_entries
  alter column percent_base set default 'base_price';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_finance_rules_percent_base_check'
  ) then
    alter table public.company_finance_rules
      add constraint company_finance_rules_percent_base_check
      check (percent_base in ('base_price', 'gross_before_discount', 'gross_after_discount'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_finance_entries_percent_base_check'
  ) then
    alter table public.order_finance_entries
      add constraint order_finance_entries_percent_base_check
      check (percent_base in ('base_price', 'gross_before_discount', 'gross_after_discount'));
  end if;
end
$$;

create or replace function public.finance_compute_amount(
  p_calc_mode text,
  p_input_amount numeric,
  p_input_percent numeric,
  p_percent_base text,
  p_base_price numeric,
  p_gross_before_discount numeric,
  p_gross_after_discount numeric,
  p_net_before_expense numeric
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_base numeric := 0;
begin
  if lower(coalesce(p_calc_mode, 'fixed')) = 'fixed' then
    return round(coalesce(p_input_amount, 0), 2);
  end if;

  case lower(coalesce(p_percent_base, 'base_price'))
    when 'base_price' then v_base := coalesce(p_base_price, 0);
    when 'gross_before_discount' then v_base := coalesce(p_gross_before_discount, 0);
    when 'gross_after_discount' then v_base := coalesce(p_gross_after_discount, 0);
    else v_base := coalesce(p_base_price, 0);
  end case;

  return round((v_base * coalesce(p_input_percent, 0) / 100.0)::numeric, 2);
end;
$$;

do $$
declare
  v_order_id uuid;
begin
  for v_order_id in
    select id
    from public.orders
  loop
    perform public.recalculate_order_finance_totals(v_order_id);
  end loop;
end
$$;

commit;
