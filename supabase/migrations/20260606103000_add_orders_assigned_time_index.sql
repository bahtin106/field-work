do $$
begin
  if to_regclass('public.orders') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'assigned_to'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'time_window_start'
    )
  then
    create index if not exists orders_assigned_time_idx
      on public.orders (assigned_to, time_window_start desc)
      where assigned_to is not null;
  end if;
end $$;
