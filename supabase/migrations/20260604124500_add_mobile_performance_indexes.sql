do $$
begin
  if to_regclass('public.orders') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'assigned_to'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'status'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'time_window_start'
    ) then
      create index if not exists orders_assigned_status_time_idx
        on public.orders (assigned_to, status, time_window_start desc)
        where assigned_to is not null;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'status'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'time_window_start'
    ) then
      create index if not exists orders_status_time_idx
        on public.orders (status, time_window_start desc);
      create index if not exists orders_feed_time_idx
        on public.orders (time_window_start desc)
        where assigned_to is null;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'client_id'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'time_window_start'
    ) then
      create index if not exists orders_client_time_idx
        on public.orders (client_id, time_window_start desc)
        where client_id is not null;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'object_id'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'time_window_start'
    ) then
      create index if not exists orders_object_time_idx
        on public.orders (object_id, time_window_start desc)
        where object_id is not null;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'company_id'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'time_window_start'
    ) then
      create index if not exists orders_company_time_idx
        on public.orders (company_id, time_window_start desc);
    end if;
  end if;

  if to_regclass('public.client_objects') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'client_objects' and column_name = 'company_id'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'client_objects' and column_name = 'is_primary'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'client_objects' and column_name = 'created_at'
    ) then
      create index if not exists client_objects_company_primary_created_idx
        on public.client_objects (company_id, is_primary desc, created_at);
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'client_objects' and column_name = 'client_id'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'client_objects' and column_name = 'company_id'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'client_objects' and column_name = 'is_primary'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'client_objects' and column_name = 'created_at'
    ) then
      create index if not exists client_objects_client_company_primary_created_idx
        on public.client_objects (client_id, company_id, is_primary desc, created_at);
    end if;
  end if;
end $$;
