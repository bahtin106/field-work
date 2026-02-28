begin;

do $$
begin
  if exists (
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
       set assigned_to = null
     where o.assigned_to is not null
       and not exists (
         select 1
           from public.profiles p
          where p.id = o.assigned_to
       );

    if not exists (
      select 1
        from pg_constraint
       where conname = 'orders_assigned_to_fkey'
         and conrelid = 'public.orders'::regclass
    ) then
      alter table public.orders
        add constraint orders_assigned_to_fkey
        foreign key (assigned_to)
        references public.profiles(id)
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
       and column_name = 'department_id'
  )
  and exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'departments'
       and column_name = 'id'
  ) then
    update public.orders o
       set department_id = null
     where o.department_id is not null
       and not exists (
         select 1
           from public.departments d
          where d.id = o.department_id
       );

    if not exists (
      select 1
        from pg_constraint
       where conname = 'orders_department_id_fkey'
         and conrelid = 'public.orders'::regclass
    ) then
      alter table public.orders
        add constraint orders_department_id_fkey
        foreign key (department_id)
        references public.departments(id)
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
       and column_name = 'work_type_id'
  )
  and exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'work_types'
       and column_name = 'id'
  ) then
    update public.orders o
       set work_type_id = null
     where o.work_type_id is not null
       and not exists (
         select 1
           from public.work_types wt
          where wt.id = o.work_type_id
       );

    if not exists (
      select 1
        from pg_constraint
       where conname = 'orders_work_type_id_fkey'
         and conrelid = 'public.orders'::regclass
    ) then
      alter table public.orders
        add constraint orders_work_type_id_fkey
        foreign key (work_type_id)
        references public.work_types(id)
        on delete set null;
    end if;
  end if;
end
$$;

create index if not exists idx_orders_assigned_to on public.orders(assigned_to)
  where assigned_to is not null;

create index if not exists idx_orders_department_id on public.orders(department_id)
  where department_id is not null;

create index if not exists idx_orders_work_type_id on public.orders(work_type_id)
  where work_type_id is not null;

commit;
