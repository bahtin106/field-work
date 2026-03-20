begin;

create or replace function public.remove_order_media_url_v2(
  p_order_id uuid,
  p_company_id uuid,
  p_category text,
  p_url text
)
returns table(media_urls text[], updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_current text[];
  v_next text[];
  v_category text;
  v_payload jsonb;
begin
  v_category := lower(trim(coalesce(p_category, '')));
  if v_category not in ('contract_file', 'photo_before', 'photo_after', 'act_file', 'media_file_5') then
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

grant execute on function public.remove_order_media_url_v2(uuid, uuid, text, text) to authenticated, service_role;

commit;
