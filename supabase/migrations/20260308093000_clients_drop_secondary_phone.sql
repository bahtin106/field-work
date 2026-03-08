begin;

update public.clients
set additional_phone_1 = nullif(btrim(coalesce(secondary_phone, '')), '')
where nullif(btrim(coalesce(additional_phone_1, '')), '') is null
  and nullif(btrim(coalesce(secondary_phone, '')), '') is not null;

drop function if exists public.search_orders(text, uuid, text, text[], boolean, integer, integer);
drop view if exists public.orders_secure_v2;
drop view if exists public.orders_secure;
drop view if exists public.orders_read_masked;

create or replace function public.clients_sync_name_and_audit()
returns trigger
language plpgsql
as $$
declare
  v_uid uuid := auth.uid();
  v_company_id uuid := user_company_id();
  v_full_name text;
begin
  new.company_id := coalesce(new.company_id, v_company_id);

  if new.company_id is null then
    raise exception 'company is required for clients' using errcode = '42501';
  end if;

  if v_company_id is not null and new.company_id <> v_company_id then
    raise exception 'client does not belong to current company' using errcode = '42501';
  end if;

  new.first_name := btrim(coalesce(new.first_name, ''));
  new.last_name := btrim(coalesce(new.last_name, ''));
  new.middle_name := nullif(btrim(coalesce(new.middle_name, '')), '');
  new.comment := nullif(left(btrim(coalesce(new.comment, '')), 280), '');
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.phone := nullif(btrim(coalesce(new.phone, '')), '');
  new.additional_phone_1 := nullif(btrim(coalesce(new.additional_phone_1, '')), '');
  new.additional_phone_1_label := nullif(left(btrim(coalesce(new.additional_phone_1_label, '')), 48), '');
  new.additional_phone_2 := nullif(btrim(coalesce(new.additional_phone_2, '')), '');
  new.additional_phone_2_label := nullif(left(btrim(coalesce(new.additional_phone_2_label, '')), 48), '');
  new.additional_phone_3 := nullif(btrim(coalesce(new.additional_phone_3, '')), '');
  new.additional_phone_3_label := nullif(left(btrim(coalesce(new.additional_phone_3_label, '')), 48), '');

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
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, v_uid);
  end if;

  new.updated_at := now();
  new.updated_by := coalesce(v_uid, new.updated_by);

  return new;
end
$$;

alter table public.clients
  drop column if exists secondary_phone;

create or replace view public.orders_read_masked as
select
  o.*,
  coalesce(
    nullif(trim(coalesce(c.full_name, '')), ''),
    nullif(
      regexp_replace(
        trim(concat_ws(' ', c.last_name, c.first_name, coalesce(c.middle_name, ''))),
        '\s+',
        ' ',
        'g'
      ),
      ''
    )
  ) as fio,
  co.name as object_name,
  co.summary as object_summary,
  c.phone as customer_phone_visible,
  c.additional_phone_1 as secondary_phone_search,
  public.mask_order_phone_ru(c.phone) as customer_phone_masked
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
       or to_jsonb(v)::text ilike '%' || trim(p_query) || '%'
     )
   order by coalesce(v.time_window_start, v.created_at) desc nulls last
   limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.search_orders(text, uuid, text, text[], boolean, integer, integer)
  to authenticated;

comment on column public.clients.additional_phone_1 is
  'Additional client phone slot #1.';

commit;
