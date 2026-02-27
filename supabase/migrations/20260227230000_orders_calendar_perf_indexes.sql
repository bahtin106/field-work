-- Calendar performance indexes for orders access patterns.
-- Safe to run multiple times.

create index if not exists idx_orders_time_window_start_desc
  on public.orders (time_window_start desc);

create index if not exists idx_orders_assigned_to_time_window_start_desc
  on public.orders (assigned_to, time_window_start desc)
  where assigned_to is not null;

create index if not exists idx_orders_company_time_window_start_desc
  on public.orders (company_id, time_window_start desc)
  where company_id is not null;

create index if not exists idx_orders_status_time_window_start_desc
  on public.orders (status, time_window_start desc)
  where status is not null;
