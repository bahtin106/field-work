begin;

alter table public.orders
  add column if not exists payment_method text;

update public.orders
set payment_method = 'cash'
where payment_method is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_payment_method_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_payment_method_check
      check (payment_method in ('cash', 'cashless'));
  end if;
end
$$;

alter table public.orders
  alter column payment_method set default 'cash',
  alter column payment_method set not null;

comment on column public.orders.payment_method is
  'How the client paid for the order: cash to executor or cashless to company.';

commit;
