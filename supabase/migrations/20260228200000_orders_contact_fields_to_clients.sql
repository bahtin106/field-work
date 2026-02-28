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
      and p.proname in ('search_orders')
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

alter table public.clients
  add column if not exists secondary_phone text,
  add column if not exists contact_pref text;

create or replace function public.clients_sync_name_and_audit()
returns trigger
language plpgsql
as $$
declare
  v_uid uuid := auth.uid();
  v_full_name text;
begin
  new.first_name := btrim(coalesce(new.first_name, ''));
  new.last_name := btrim(coalesce(new.last_name, ''));
  new.middle_name := nullif(btrim(coalesce(new.middle_name, '')), '');
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.phone := nullif(btrim(coalesce(new.phone, '')), '');
  new.secondary_phone := nullif(btrim(coalesce(new.secondary_phone, '')), '');
  new.contact_pref := nullif(btrim(coalesce(new.contact_pref, '')), '');

  v_full_name := nullif(
    regexp_replace(
      btrim(concat_ws(' ', new.last_name, new.first_name, coalesce(new.middle_name, ''))),
      '\s+',
      ' ',
      'g'
    ),
    ''
  );
  new.full_name := coalesce(v_full_name, new.full_name, '');

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, v_uid);
    new.updated_by := coalesce(new.updated_by, v_uid);
  end if;

  new.updated_by := coalesce(v_uid, new.updated_by);

  return new;
end
$$;

do $$
declare
  has_phone boolean;
  has_secondary_phone boolean;
  has_contact_email boolean;
  has_contact_pref boolean;
  phone_expr text;
  secondary_expr text;
  contact_email_expr text;
  contact_pref_expr text;
  phone_filter text;
  secondary_filter text;
  contact_email_filter text;
  contact_pref_filter text;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'phone'
  ) into has_phone;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'secondary_phone'
  ) into has_secondary_phone;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'contact_email'
  ) into has_contact_email;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'contact_pref'
  ) into has_contact_pref;

  if not has_phone and not has_secondary_phone and not has_contact_email and not has_contact_pref then
    return;
  end if;

  phone_expr := case
    when has_phone then 'nullif(trim(coalesce(o.phone, '''')), '''')'
    else 'null::text'
  end;
  secondary_expr := case
    when has_secondary_phone then 'nullif(trim(coalesce(o.secondary_phone, '''')), '''')'
    else 'null::text'
  end;
  contact_email_expr := case
    when has_contact_email then 'nullif(lower(trim(coalesce(o.contact_email, ''''))), '''')'
    else 'null::text'
  end;
  contact_pref_expr := case
    when has_contact_pref then 'o.contact_pref::text'
    else 'null::text'
  end;

  phone_filter := case
    when has_phone then 'nullif(trim(coalesce(o.phone, '''')), '''') is not null'
    else 'false'
  end;
  secondary_filter := case
    when has_secondary_phone then 'nullif(trim(coalesce(o.secondary_phone, '''')), '''') is not null'
    else 'false'
  end;
  contact_email_filter := case
    when has_contact_email then 'nullif(lower(trim(coalesce(o.contact_email, ''''))), '''') is not null'
    else 'false'
  end;
  contact_pref_filter := case
    when has_contact_pref then 'o.contact_pref is not null'
    else 'false'
  end;

  execute format(
    $sql$
      with latest_client_contacts as (
        select distinct on (o.client_id)
          o.client_id,
          %1$s as phone,
          %2$s as secondary_phone,
          %3$s as contact_email,
          %4$s as contact_pref
        from public.orders o
        where o.client_id is not null
          and (%5$s or %6$s or %7$s or %8$s)
        order by
          o.client_id,
          coalesce(o.updated_at, o.created_at) desc nulls last,
          o.created_at desc nulls last,
          o.id desc
      )
      update public.clients c
         set phone = case
               when nullif(trim(coalesce(c.phone, '')), '') is null
                 then latest_client_contacts.phone
               else c.phone
             end,
             secondary_phone = case
               when nullif(trim(coalesce(c.secondary_phone, '')), '') is null
                 then latest_client_contacts.secondary_phone
               else c.secondary_phone
             end,
             email = case
               when nullif(lower(trim(coalesce(c.email, ''))), '') is null
                 then latest_client_contacts.contact_email
               else c.email
             end,
             contact_pref = coalesce(c.contact_pref, latest_client_contacts.contact_pref)
        from latest_client_contacts
       where c.id = latest_client_contacts.client_id
         and (
           (nullif(trim(coalesce(c.phone, '')), '') is null and latest_client_contacts.phone is not null)
           or
           (nullif(trim(coalesce(c.secondary_phone, '')), '') is null and latest_client_contacts.secondary_phone is not null)
           or (nullif(lower(trim(coalesce(c.email, ''))), '') is null and latest_client_contacts.contact_email is not null)
           or (c.contact_pref is null and latest_client_contacts.contact_pref is not null)
         )
    $sql$,
    phone_expr,
    secondary_expr,
    contact_email_expr,
    contact_pref_expr,
    phone_filter,
    secondary_filter,
    contact_email_filter,
    contact_pref_filter
  );
end
$$;

update public.clients
set phone = nullif(trim(coalesce(phone, '')), '')
where phone is distinct from nullif(trim(coalesce(phone, '')), '');

update public.clients
set secondary_phone = nullif(trim(coalesce(secondary_phone, '')), '')
where secondary_phone is distinct from nullif(trim(coalesce(secondary_phone, '')), '');

update public.clients
set email = nullif(lower(trim(coalesce(email, ''))), '')
where email is distinct from nullif(lower(trim(coalesce(email, ''))), '');

alter table public.orders
  drop column if exists phone,
  drop column if exists secondary_phone,
  drop column if exists contact_email,
  drop column if exists contact_pref;

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
  c.secondary_phone,
  c.email as contact_email,
  c.contact_pref,
  c.phone as customer_phone_visible,
  public.mask_order_phone_ru(c.phone) as customer_phone_masked,
  c.phone as phone_visible
from public.orders o
left join public.client_objects co on co.id = o.object_id
left join public.clients c on c.id = o.client_id;

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
         v.secondary_phone,
         v.contact_email,
         v.contact_pref,
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

comment on column public.clients.secondary_phone is
  'Additional client phone. Source of truth for non-primary contact number.';
comment on column public.clients.contact_pref is
  'Preferred client contact method. Source of truth for contact preference.';

commit;
