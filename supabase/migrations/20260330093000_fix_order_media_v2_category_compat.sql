-- Fix order media RPC category compatibility after media column rename.
-- Supports both new keys (media_file_1..5) and legacy aliases.

create or replace function public.append_order_media_url_v2(
  p_order_id uuid,
  p_company_id uuid,
  p_category text,
  p_url text
)
returns table (media_urls text[], updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_current text[];
  v_next text[];
  v_category_raw text;
  v_category text;
  v_payload jsonb;
begin
  v_category_raw := lower(trim(coalesce(p_category, '')));
  v_category := case
    when v_category_raw in ('media_file_1', 'contract_file', 'photo_1', 'media_1', 'media_before', 'photo_before') then 'media_file_1'
    when v_category_raw in ('media_file_2', 'photo_before_2', 'photo_2', 'media_2', 'media_after', 'photo_after') then 'media_file_2'
    when v_category_raw in ('media_file_3', 'photo_after_2', 'photo_3', 'media_3') then 'media_file_3'
    when v_category_raw in ('media_file_4', 'act_file', 'photo_4', 'media_4') then 'media_file_4'
    when v_category_raw in ('media_file_5', 'photo_5', 'media_5') then 'media_file_5'
    else null
  end;

  if v_category is null then
    raise exception 'Unsupported category';
  end if;

  select *
    into v_order
    from public.orders
   where id = p_order_id
     and company_id = p_company_id
   for update;

  if not found then
    raise exception 'Order not found';
  end if;

  v_payload := to_jsonb(v_order) -> v_category;
  if jsonb_typeof(v_payload) is distinct from 'array' then
    v_payload := '[]'::jsonb;
  end if;

  select coalesce(array_agg(value), '{}'::text[])
    into v_current
    from jsonb_array_elements_text(v_payload);

  v_next := array(
    select x.val
      from (
        select e as val, min(ord) as first_ord
          from unnest(array[p_url] || coalesce(v_current, '{}'::text[])) with ordinality t(e, ord)
         where coalesce(e, '') <> ''
         group by e
      ) x
     order by x.first_ord
  );

  execute format(
    'update public.orders o
        set %I = $1,
            updated_at = now()
      where o.id = $2
      returning o.%I, o.updated_at',
    v_category,
    v_category
  )
  into media_urls, updated_at
  using v_next, v_order.id;

  return next;
end;
$$;

create or replace function public.remove_order_media_url_v2(
  p_order_id uuid,
  p_company_id uuid,
  p_category text,
  p_url text
)
returns table (media_urls text[], updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_current text[];
  v_next text[];
  v_category_raw text;
  v_category text;
  v_payload jsonb;
begin
  v_category_raw := lower(trim(coalesce(p_category, '')));
  v_category := case
    when v_category_raw in ('media_file_1', 'contract_file', 'photo_1', 'media_1', 'media_before', 'photo_before') then 'media_file_1'
    when v_category_raw in ('media_file_2', 'photo_before_2', 'photo_2', 'media_2', 'media_after', 'photo_after') then 'media_file_2'
    when v_category_raw in ('media_file_3', 'photo_after_2', 'photo_3', 'media_3') then 'media_file_3'
    when v_category_raw in ('media_file_4', 'act_file', 'photo_4', 'media_4') then 'media_file_4'
    when v_category_raw in ('media_file_5', 'photo_5', 'media_5') then 'media_file_5'
    else null
  end;

  if v_category is null then
    raise exception 'Unsupported category';
  end if;

  select *
    into v_order
    from public.orders
   where id = p_order_id
     and company_id = p_company_id
   for update;

  if not found then
    raise exception 'Order not found';
  end if;

  v_payload := to_jsonb(v_order) -> v_category;
  if jsonb_typeof(v_payload) is distinct from 'array' then
    v_payload := '[]'::jsonb;
  end if;

  select coalesce(array_agg(value), '{}'::text[])
    into v_current
    from jsonb_array_elements_text(v_payload);

  v_next := array(
    select e
      from unnest(coalesce(v_current, '{}'::text[])) t(e)
     where coalesce(e, '') <> ''
       and e <> p_url
  );

  execute format(
    'update public.orders o
        set %I = coalesce($1, ''{}''::text[]),
            updated_at = now()
      where o.id = $2
      returning o.%I, o.updated_at',
    v_category,
    v_category
  )
  into media_urls, updated_at
  using v_next, v_order.id;

  return next;
end;
$$;

grant execute on function public.append_order_media_url_v2(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.remove_order_media_url_v2(uuid, uuid, text, text) to authenticated, service_role;

