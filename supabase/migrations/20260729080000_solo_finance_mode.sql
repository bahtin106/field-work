begin;

-- The active work mode must live with the company, not only in an auth token:
-- finance is recalculated on the server even when no user is currently online.
alter table public.companies
  add column if not exists work_mode text not null default 'company';

alter table public.companies
  drop constraint if exists companies_work_mode_check;
alter table public.companies
  add constraint companies_work_mode_check
  check (work_mode in ('solo', 'company'));

comment on column public.companies.work_mode is
  'Operating mode used by server-side calculations: solo or company.';

-- Bring existing companies in line with their administrator's current account
-- type. A company is considered solo only when an administrator explicitly
-- has that account type.
update public.companies company
set work_mode = case
  when exists (
    select 1
      from public.profiles profile
      join auth.users user_row on user_row.id = profile.id
     where profile.company_id = company.id
       and lower(coalesce(profile.role, '')) = 'admin'
       and lower(coalesce(user_row.raw_user_meta_data ->> 'account_type', '')) = 'solo'
  ) then 'solo'
  else 'company'
end;

-- New solo registrations create a company before the profile row exists.
-- Synchronize the durable company mode as soon as that administrator profile
-- is attached to the company.
create or replace function public.trg_sync_company_work_mode_from_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if new.company_id is not null
     and lower(coalesce(new.role, '')) = 'admin'
     and exists (
       select 1
         from auth.users user_row
        where user_row.id = new.id
          and lower(coalesce(user_row.raw_user_meta_data ->> 'account_type', '')) = 'solo'
     ) then
    update public.companies
       set work_mode = 'solo'
     where id = new.company_id
       and work_mode is distinct from 'solo';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_company_work_mode_from_admin_profile on public.profiles;
create trigger trg_sync_company_work_mode_from_admin_profile
after insert or update of company_id, role
on public.profiles
for each row execute function public.trg_sync_company_work_mode_from_admin_profile();

-- In solo mode a request has no company-to-worker split. Keep the underlying
-- company schemes and old worker entries untouched so switching back restores
-- them, but expose a clean personal result for every open request.
create or replace function public.trg_apply_solo_finance_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_direct_cost numeric := 0;
  v_personal_income numeric := 0;
  v_mode text;
begin
  select company.work_mode
    into v_mode
    from public.companies company
   where company.id = new.company_id;

  if v_mode is distinct from 'solo' then
    return new;
  end if;

  -- A closed company request is historical data. Switching the company to
  -- solo must never rewrite its saved result.
  if tg_op = 'UPDATE' and old.locked_at is not null then
    return new;
  end if;

  v_direct_cost := greatest(
    coalesce(
      nullif(new.breakdown_json #>> '{company,direct_costs}', '')::numeric,
      new.company_cost_total,
      0
    ),
    0
  );
  v_personal_income := round(coalesce(new.customer_total, 0) - v_direct_cost, 2);

  new.scheme_id := null;
  new.scheme_version_id := null;
  new.scheme_name := null;
  new.scheme_version_number := null;
  new.money_holder := 'company';
  new.worker_base_compensation_total := 0;
  new.worker_bonus_total := 0;
  new.worker_deduction_total := 0;
  new.worker_compensation_total := 0;
  new.worker_reimbursement_total := 0;
  new.worker_payable_total := 0;
  new.company_cost_total := round(v_direct_cost, 2);
  new.company_margin_total := v_personal_income;
  new.worker_paid_total := 0;
  new.company_received_total := 0;
  new.settlement_direction := 'settled';
  new.settlement_amount := 0;
  new.settlement_status := 'settled';
  new.breakdown_json := jsonb_build_object(
    'customer', coalesce(
      new.breakdown_json -> 'customer',
      jsonb_build_object(
        'base', round(coalesce(new.customer_base_total, 0), 2),
        'charges', round(coalesce(new.customer_charge_total, 0), 2),
        'discounts', round(coalesce(new.customer_discount_total, 0), 2),
        'total', round(coalesce(new.customer_total, 0), 2)
      )
    ),
    'worker', jsonb_build_object(
      'base_compensation', 0,
      'bonuses', 0,
      'deductions', 0,
      'compensation', 0,
      'reimbursements', 0,
      'payable', 0
    ),
    'company', jsonb_build_object(
      'direct_costs', round(v_direct_cost, 2),
      'total_costs', round(v_direct_cost, 2),
      'margin', v_personal_income
    ),
    'settlement', jsonb_build_object(
      'money_holder', 'company',
      'worker_paid', 0,
      'company_received', 0,
      'direction', 'settled',
      'amount', 0,
      'status', 'settled'
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_apply_solo_finance_snapshot on public.order_finance_snapshots;
create trigger trg_apply_solo_finance_snapshot
before insert or update
on public.order_finance_snapshots
for each row execute function public.trg_apply_solo_finance_snapshot();

-- recalculate_order_finance_v2 writes cached totals to orders after it stores
-- the snapshot. Read that normalized snapshot back so the order cache, lists
-- and statistics show the same personal income in solo mode.
create or replace function public.trg_apply_solo_finance_order_totals()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_snapshot public.order_finance_snapshots%rowtype;
begin
  if not exists (
    select 1
      from public.companies company
     where company.id = new.company_id
       and company.work_mode = 'solo'
  ) then
    return new;
  end if;

  select *
    into v_snapshot
    from public.order_finance_snapshots snapshot
   where snapshot.order_id = new.id;

  if not found or v_snapshot.locked_at is not null then
    return new;
  end if;

  new.finance_income_total := round(coalesce(v_snapshot.customer_charge_total, 0), 2);
  new.finance_discount_total := round(coalesce(v_snapshot.customer_discount_total, 0), 2);
  new.finance_expense_total := round(coalesce(v_snapshot.company_cost_total, 0), 2);
  new.finance_gross_total := round(coalesce(v_snapshot.customer_total, 0), 2);
  new.finance_net_total := round(coalesce(v_snapshot.company_margin_total, 0), 2);
  return new;
end;
$$;

drop trigger if exists trg_apply_solo_finance_order_totals on public.orders;
create trigger trg_apply_solo_finance_order_totals
before update of
  finance_income_total,
  finance_discount_total,
  finance_expense_total,
  finance_gross_total,
  finance_net_total
on public.orders
for each row execute function public.trg_apply_solo_finance_order_totals();

-- Recalculate only open requests whenever the operating mode changes. Company
-- schemes and worker-specific entries remain stored and are used again after
-- returning to company mode; completed request snapshots stay immutable.
create or replace function public.trg_recalculate_finance_on_work_mode_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order_id uuid;
begin
  if old.work_mode is not distinct from new.work_mode then
    return new;
  end if;

  for v_order_id in
    select order_row.id
      from public.orders order_row
      left join public.order_finance_snapshots snapshot on snapshot.order_id = order_row.id
     where order_row.company_id = new.id
       and snapshot.locked_at is null
  loop
    perform public.recalculate_order_finance_v2(v_order_id, true);
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_recalculate_finance_on_work_mode_change on public.companies;
create trigger trg_recalculate_finance_on_work_mode_change
after update of work_mode
on public.companies
for each row execute function public.trg_recalculate_finance_on_work_mode_change();

commit;
