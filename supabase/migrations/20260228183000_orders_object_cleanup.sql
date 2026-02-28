begin;

do $$
declare
  r record;
begin
  for r in
    select
      n.nspname as schema_name,
      p.proname as routine_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('search_orders', 'get_order_with_custom', 'save_order_custom_fields')
  loop
    execute format(
      'drop function if exists %I.%I(%s);',
      r.schema_name,
      r.routine_name,
      r.identity_args
    );
  end loop;
end
$$;

drop materialized view if exists public.mv_orders_daily_counts;
drop view if exists public.orders_secure_v2;
drop view if exists public.orders_secure;
drop view if exists public.orders_read_masked;

drop trigger if exists trg_orders_sync_client_from_object on public.orders;
drop function if exists public.orders_sync_client_from_object();
drop trigger if exists trg_orders_validate_object_link on public.orders;

alter table public.orders
  drop constraint if exists orders_object_id_fkey;

alter table public.orders
  add constraint orders_object_id_fkey
  foreign key (object_id) references public.client_objects(id) on delete restrict;

alter table public.orders
  drop column if exists country,
  drop column if exists region,
  drop column if exists city,
  drop column if exists street,
  drop column if exists house,
  drop column if exists postal_code,
  drop column if exists building,
  drop column if exists floor,
  drop column if exists entrance,
  drop column if exists apartment,
  drop column if exists intercom,
  drop column if exists entrance_info,
  drop column if exists parking_notes,
  drop column if exists geo_lat,
  drop column if exists geo_lng,
  drop column if exists custom;

create or replace function public.mask_order_phone_ru(p_phone text)
returns text
language sql
immutable
as $$
  select case
    when nullif(trim(coalesce(p_phone, '')), '') is null then null
    else regexp_replace(
      regexp_replace(trim(p_phone), '\D', '', 'g'),
      '^(\d)(\d{3})(\d{3})(\d{2})(\d{2})$',
      '+\1 (\2) ***-**-\5'
    )
  end
$$;

create or replace function public.orders_validate_object_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object public.client_objects%rowtype;
begin
  if new.object_id is null then
    if new.client_id is not null then
      raise exception 'object_id is required when client_id is provided'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select *
    into v_object
    from public.client_objects
   where id = new.object_id;

  if v_object.id is null then
    raise exception 'client object % not found', new.object_id
      using errcode = '23503';
  end if;

  if new.company_id is distinct from v_object.company_id then
    raise exception 'client object % does not belong to company %', new.object_id, new.company_id
      using errcode = '42501';
  end if;

  if new.client_id is not null and new.client_id is distinct from v_object.client_id then
    raise exception 'client object % does not belong to client %', new.object_id, new.client_id
      using errcode = '42501';
  end if;

  new.client_id := v_object.client_id;
  return new;
end;
$$;

create trigger trg_orders_validate_object_link
before insert or update of company_id, client_id, object_id
on public.orders
for each row
execute function public.orders_validate_object_link();

create or replace function public.update_order_if_version(
  p_order_id text,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.orders%rowtype;
  v_updated public.orders%rowtype;
begin
  select *
    into v_current
    from public.orders
   where id::text = p_order_id
   for update;

  if not found then
    return null;
  end if;

  if p_expected_updated_at is not null
     and v_current.updated_at is distinct from p_expected_updated_at then
    return null;
  end if;

  update public.orders o
     set title = case when p_patch ? 'title' then (p_patch->>'title') else o.title end,
         comment = case when p_patch ? 'comment' then (p_patch->>'comment') else o.comment end,
         fio = case when p_patch ? 'fio' then (p_patch->>'fio') else o.fio end,
         phone = case when p_patch ? 'phone' then (p_patch->>'phone') else o.phone end,
         secondary_phone = case
           when p_patch ? 'secondary_phone' then nullif(p_patch->>'secondary_phone', '')
           else o.secondary_phone
         end,
         contact_email = case
           when p_patch ? 'contact_email' then nullif(p_patch->>'contact_email', '')
           else o.contact_email
         end,
         contact_pref = case
           when p_patch ? 'contact_pref' then nullif(p_patch->>'contact_pref', '')::public.contact_pref_enum
           else o.contact_pref
         end,
         assigned_to = case
           when p_patch ? 'assigned_to' then nullif(p_patch->>'assigned_to', '')::uuid
           else o.assigned_to
         end,
         client_id = case
           when p_patch ? 'client_id' then nullif(p_patch->>'client_id', '')::uuid
           else o.client_id
         end,
         object_id = case
           when p_patch ? 'object_id' then nullif(p_patch->>'object_id', '')::uuid
           else o.object_id
         end,
         time_window_start = case
           when p_patch ? 'time_window_start' then nullif(p_patch->>'time_window_start', '')::timestamptz
           else o.time_window_start
         end,
         time_window_end = case
           when p_patch ? 'time_window_end' then nullif(p_patch->>'time_window_end', '')::timestamptz
           else o.time_window_end
         end,
         status = case when p_patch ? 'status' then (p_patch->>'status') else o.status end,
         urgent = case
           when p_patch ? 'urgent' then coalesce((p_patch->>'urgent')::boolean, false)
           else o.urgent
         end,
         department_id = case
           when p_patch ? 'department_id' then nullif(p_patch->>'department_id', '')::uuid
           else o.department_id
         end,
         price = case
           when p_patch ? 'price' then nullif(p_patch->>'price', '')::numeric
           else o.price
         end,
         fuel_cost = case
           when p_patch ? 'fuel_cost' then nullif(p_patch->>'fuel_cost', '')::numeric
           else o.fuel_cost
         end,
         work_type_id = case
           when p_patch ? 'work_type_id' then nullif(p_patch->>'work_type_id', '')::uuid
           else o.work_type_id
         end,
         contract_file = case
           when p_patch ? 'contract_file' then
             case
               when p_patch->'contract_file' = 'null'::jsonb then null
               else array(select jsonb_array_elements_text(p_patch->'contract_file'))
             end
           else o.contract_file
         end,
         photo_before = case
           when p_patch ? 'photo_before' then
             case
               when p_patch->'photo_before' = 'null'::jsonb then null
               else array(select jsonb_array_elements_text(p_patch->'photo_before'))
             end
           else o.photo_before
         end,
         photo_after = case
           when p_patch ? 'photo_after' then
             case
               when p_patch->'photo_after' = 'null'::jsonb then null
               else array(select jsonb_array_elements_text(p_patch->'photo_after'))
             end
           else o.photo_after
         end,
         act_file = case
           when p_patch ? 'act_file' then
             case
               when p_patch->'act_file' = 'null'::jsonb then null
               else array(select jsonb_array_elements_text(p_patch->'act_file'))
             end
           else o.act_file
         end
   where o.id::text = p_order_id
  returning o.*
    into v_updated;

  return v_updated;
end;
$$;

grant execute on function public.update_order_if_version(text, timestamptz, jsonb) to authenticated;

create or replace view public.orders_read_masked as
select
  o.*,
  co.name as object_name,
  co.summary as object_summary,
  co.country,
  co.region,
  co.city,
  co.street,
  co.house,
  co.postal_code,
  co.building,
  co.floor,
  co.entrance,
  co.apartment,
  co.intercom,
  co.entrance_info,
  co.parking_notes,
  co.geo_lat,
  co.geo_lng,
  o.phone as customer_phone_visible,
  public.mask_order_phone_ru(o.phone) as customer_phone_masked,
  o.phone as phone_visible
from public.orders o
left join public.client_objects co on co.id = o.object_id;

create or replace view public.orders_secure as
select *
from public.orders_read_masked;

create or replace view public.orders_secure_v2 as
select *
from public.orders_read_masked;

create or replace function public.search_orders(
  p_query text,
  p_company_id uuid,
  p_status text,
  p_work_type_ids text[],
  p_include_feed boolean,
  p_limit integer,
  p_offset integer
)
returns setof public.orders_secure_v2
language sql
security definer
set search_path = public
as $$
  select v.*
    from public.orders_secure_v2 v
   where (p_company_id is null or v.company_id = p_company_id)
     and (
       nullif(trim(coalesce(p_status, '')), '') is null
       or v.status = p_status
     )
     and (
       p_work_type_ids is null
       or cardinality(p_work_type_ids) = 0
       or v.work_type_id::text = any (p_work_type_ids)
     )
     and (
       coalesce(p_include_feed, true)
       or v.assigned_to is not null
     )
     and (
       nullif(trim(coalesce(p_query, '')), '') is null
       or concat_ws(
         ' ',
         v.title,
         v.fio,
         v.customer_phone_visible,
         v.region,
         v.city,
         v.street,
         v.house,
         v.object_name,
         v.object_summary
       ) ilike '%' || trim(p_query) || '%'
     )
   order by coalesce(v.time_window_start, v.created_at) desc nulls last
   limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.search_orders(text, uuid, text, text[], boolean, integer, integer)
  to authenticated;

create materialized view public.mv_orders_daily_counts as
select
  o.company_id,
  coalesce(o.time_window_start::date, o.created_at::date) as day,
  o.status,
  count(*)::bigint as orders_count
from public.orders o
group by 1, 2, 3;

create unique index if not exists mv_orders_daily_counts_company_day_status_idx
  on public.mv_orders_daily_counts(company_id, day, status);

comment on column public.orders.client_id is
  'Client foreign key. Maintained consistently with object_id by trg_orders_validate_object_link.';
comment on column public.orders.object_id is
  'Object foreign key. Address and object-level access data live in client_objects; orders no longer duplicate them.';

commit;
