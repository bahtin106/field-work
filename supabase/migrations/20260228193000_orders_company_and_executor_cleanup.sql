begin;

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'orders'
       and column_name = 'company_id'
  )
  and exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'companies'
       and column_name = 'id'
  ) then
    update public.orders o
       set company_id = null
     where o.company_id is not null
       and not exists (
         select 1
           from public.companies c
          where c.id = o.company_id
       );

    if not exists (
      select 1
        from pg_constraint
       where conname = 'orders_company_id_fkey'
         and conrelid = 'public.orders'::regclass
    ) then
      alter table public.orders
        add constraint orders_company_id_fkey
        foreign key (company_id)
        references public.companies(id)
        on delete set null;
    end if;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'orders'
       and column_name = 'executor_id'
  )
  and exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'orders'
       and column_name = 'assigned_to'
  )
  and exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'id'
  ) then
    update public.orders o
       set assigned_to = o.executor_id
     where o.executor_id is not null
       and o.assigned_to is null
       and exists (
         select 1
           from public.profiles p
          where p.id = o.executor_id
       );

    update public.orders o
       set executor_id = null
     where o.executor_id is not null
       and not exists (
         select 1
           from public.profiles p
          where p.id = o.executor_id
       );

    update public.orders
       set executor_id = null
     where executor_id is not null;

    comment on column public.orders.executor_id is
      'DEPRECATED: legacy executor reference. Source of truth is assigned_to. Kept temporarily for compatibility with existing policies/views.';
  end if;
end
$$;

create index if not exists idx_orders_company_id
  on public.orders(company_id)
  where company_id is not null;

commit;
