set search_path = public;

-- 1) Eliminate mutable search_path warnings for exposed public functions.
do $$
declare
  r record;
begin
  for r in
    select
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and coalesce(array_to_string(p.proconfig, ','), '') !~ '(^|,)search_path='
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = pg_catalog, public, auth, storage, extensions',
      r.nspname,
      r.proname,
      r.args
    );
  end loop;
end;
$$;

-- 2) Remove SECURITY DEFINER warning on exposed views by moving privileged logic to a hardened function.
create or replace function public.orders_secure_rows()
returns setof public.orders_read_masked
language sql
stable
security definer
set search_path = public
as $$
  select
    orm.id,
    orm.created_at,
    orm.comment,
    orm.status,
    orm.media_file_1,
    orm.media_file_2,
    orm.media_file_3,
    orm.media_file_4,
    orm.media_file_5,
    orm.assigned_to,
    orm.title,
    orm.urgent,
    orm.start_price,
    orm.company_id,
    orm.time_window_start,
    orm.time_window_end,
    orm.duration_min,
    orm.arrival_at,
    orm.departure_at,
    orm.tags,
    orm.payment_status,
    orm.updated_at,
    orm.completed_at,
    orm.work_type_id,
    orm.currency,
    orm.created_by_user_id,
    orm.creation_source,
    orm.feed_entered_at,
    orm.client_id,
    orm.object_id,
    orm.address_mode,
    orm.country,
    orm.region,
    orm.city,
    orm.street,
    orm.house,
    orm.postal_code,
    orm.floor,
    orm.entrance,
    orm.apartment,
    orm.entrance_info,
    orm.parking_notes,
    orm.geo_lat,
    orm.geo_lng,
    orm.district,
    orm.payment_method,
    orm.finance_income_total,
    orm.finance_expense_total,
    orm.finance_discount_total,
    orm.finance_gross_total,
    orm.finance_net_total,
    orm.finance_calculated_at,
    orm.fio,
    orm.object_name,
    orm.object_summary,
    case
      when public.can_view_order_phone(orm.company_id, orm.assigned_to, orm.time_window_start, orm.departure_at)
        then orm.customer_phone_visible
      else null::text
    end as customer_phone_visible,
    orm.secondary_phone_search,
    orm.customer_phone_masked
  from public.orders_read_masked orm
  where (
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or orm.company_id = public.user_company_id()
    or (
      coalesce(current_setting('request.jwt.claims', true), '') = ''
      and current_user in ('postgres', 'supabase_admin')
    )
  );
$$;

revoke all on function public.orders_secure_rows() from public, anon, authenticated;
grant execute on function public.orders_secure_rows() to authenticated, service_role;

create or replace view public.orders_secure as
select * from public.orders_secure_rows();

create or replace view public.orders_secure_v2 as
select * from public.orders_secure_rows();

alter view public.orders_secure set (security_invoker = true);
alter view public.orders_secure_v2 set (security_invoker = true);

revoke all on table public.orders_secure from public, anon, authenticated, service_role;
revoke all on table public.orders_secure_v2 from public, anon, authenticated, service_role;
grant select on table public.orders_secure to authenticated, service_role;
grant select on table public.orders_secure_v2 to authenticated, service_role;
