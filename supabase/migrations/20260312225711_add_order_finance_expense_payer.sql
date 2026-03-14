begin;

alter table public.order_finance_entries
  add column if not exists expense_payer text;

update public.order_finance_entries
set expense_payer = 'company'
where expense_payer is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_finance_entries_expense_payer_check'
      and conrelid = 'public.order_finance_entries'::regclass
  ) then
    alter table public.order_finance_entries
      add constraint order_finance_entries_expense_payer_check
      check (expense_payer in ('company', 'executor'));
  end if;
end
$$;

alter table public.order_finance_entries
  alter column expense_payer set default 'company',
  alter column expense_payer set not null;

comment on column public.order_finance_entries.expense_payer is
  'Who paid the expense: company funds or executor personal funds. Applies to expense entries; other kinds keep company.';

commit;
