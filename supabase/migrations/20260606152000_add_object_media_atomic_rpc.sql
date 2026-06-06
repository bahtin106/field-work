create or replace function public.append_object_media_url_v1(
  p_object_id uuid,
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
  v_current text[];
  v_next text[];
  v_updated_at timestamptz;
begin
  if p_category not in ('media_file_1', 'media_file_2', 'media_file_3') then
    raise exception 'Invalid object media category';
  end if;

  if nullif(btrim(coalesce(p_url, '')), '') is null then
    raise exception 'Object media url is required';
  end if;

  select
    case p_category
      when 'media_file_1' then media_file_1
      when 'media_file_2' then media_file_2
      when 'media_file_3' then media_file_3
    end
  into v_current
  from public.client_objects
  where id = p_object_id
    and company_id = p_company_id
  for update;

  if not found then
    raise exception 'Object not found';
  end if;

  select coalesce(array_agg(url order by first_ord), array[]::text[])
  into v_current
  from (
    select url, min(ord) as first_ord
    from unnest(coalesce(v_current, array[]::text[])) with ordinality as item(url, ord)
    where nullif(btrim(coalesce(url, '')), '') is not null
      and url is distinct from p_url
    group by url
  ) deduped;

  v_next := array_prepend(p_url, coalesce(v_current, array[]::text[]));
  v_updated_at := now();

  update public.client_objects
  set
    media_file_1 = case when p_category = 'media_file_1' then v_next else media_file_1 end,
    media_file_2 = case when p_category = 'media_file_2' then v_next else media_file_2 end,
    media_file_3 = case when p_category = 'media_file_3' then v_next else media_file_3 end,
    updated_at = v_updated_at
  where id = p_object_id
    and company_id = p_company_id;

  return query select v_next, v_updated_at;
end;
$$;

create or replace function public.remove_object_media_url_v1(
  p_object_id uuid,
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
  v_current text[];
  v_next text[];
  v_updated_at timestamptz;
begin
  if p_category not in ('media_file_1', 'media_file_2', 'media_file_3') then
    raise exception 'Invalid object media category';
  end if;

  if nullif(btrim(coalesce(p_url, '')), '') is null then
    raise exception 'Object media url is required';
  end if;

  select
    case p_category
      when 'media_file_1' then media_file_1
      when 'media_file_2' then media_file_2
      when 'media_file_3' then media_file_3
    end
  into v_current
  from public.client_objects
  where id = p_object_id
    and company_id = p_company_id
  for update;

  if not found then
    raise exception 'Object not found';
  end if;

  select coalesce(array_agg(url order by ord), array[]::text[])
  into v_next
  from unnest(coalesce(v_current, array[]::text[])) with ordinality as item(url, ord)
  where nullif(btrim(coalesce(url, '')), '') is not null
    and url is distinct from p_url;

  v_updated_at := now();

  update public.client_objects
  set
    media_file_1 = case when p_category = 'media_file_1' then v_next else media_file_1 end,
    media_file_2 = case when p_category = 'media_file_2' then v_next else media_file_2 end,
    media_file_3 = case when p_category = 'media_file_3' then v_next else media_file_3 end,
    updated_at = v_updated_at
  where id = p_object_id
    and company_id = p_company_id;

  return query select v_next, v_updated_at;
end;
$$;

grant execute on function public.append_object_media_url_v1(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.remove_object_media_url_v1(uuid, uuid, text, text) to authenticated, service_role;
