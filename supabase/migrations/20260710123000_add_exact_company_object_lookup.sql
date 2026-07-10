create or replace function public.find_exact_company_object_for_order(
  p_street text default '',
  p_house text default '',
  p_city text default '',
  p_apartment text default '',
  p_entrance text default '',
  p_limit integer default 1
)
returns table (
  object_id uuid,
  client_id uuid,
  object_name text,
  client_name text,
  short_address text,
  score real,
  is_same_client boolean,
  country text,
  region text,
  district text,
  city text,
  street text,
  house text,
  postal_code text,
  floor text,
  entrance text,
  apartment text,
  comment text,
  geo_lat text,
  geo_lng text
)
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  with input as (
    select
      public.normalize_search_text(p_street) as norm_street,
      public.normalize_search_token(p_house) as norm_house,
      public.normalize_search_text(p_city) as norm_city,
      public.normalize_search_token(p_apartment) as norm_apartment,
      public.normalize_search_token(p_entrance) as norm_entrance,
      greatest(1, least(coalesce(p_limit, 1), 6)) as safe_limit
  )
  select
    co.id as object_id,
    co.client_id,
    co.name as object_name,
    c.full_name as client_name,
    trim(concat_ws(', ', nullif(co.city, ''), nullif(co.street, ''), nullif(co.house, ''))) as short_address,
    1::real as score,
    false as is_same_client,
    co.country,
    co.region,
    co.district,
    co.city,
    co.street,
    co.house,
    co.postal_code,
    co.floor,
    co.entrance,
    co.apartment,
    co.comment,
    co.geo_lat,
    co.geo_lng
  from public.client_objects co
  join public.clients c on c.id = co.client_id
  cross join input i
  where co.company_id = public.user_company_id()
    and i.norm_street <> ''
    and i.norm_house <> ''
    and public.normalize_search_text(co.street) = i.norm_street
    and public.normalize_search_token(co.house) = i.norm_house
    and (i.norm_city = '' or public.normalize_search_text(co.city) = i.norm_city)
    and (i.norm_apartment = '' or public.normalize_search_token(co.apartment) = i.norm_apartment)
    and (i.norm_entrance = '' or public.normalize_search_token(co.entrance) = i.norm_entrance)
  order by co.updated_at desc, co.id
  limit (select safe_limit from input);
$$;

grant execute on function public.find_exact_company_object_for_order(text, text, text, text, text, integer)
  to authenticated, service_role;
