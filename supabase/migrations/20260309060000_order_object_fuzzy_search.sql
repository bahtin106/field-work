create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create or replace function public.immutable_unaccent(p_input text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select extensions.unaccent('unaccent', coalesce(p_input, ''));
$$;

create or replace function public.normalize_search_text(p_input text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select trim(
    regexp_replace(
      lower(public.immutable_unaccent(p_input)),
      '[^a-z0-9а-я/-]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.normalize_search_token(p_input text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select regexp_replace(
    lower(public.immutable_unaccent(p_input)),
    '[^a-z0-9а-я/-]+',
    '',
    'g'
  );
$$;

create index if not exists client_objects_search_street_trgm_idx
  on public.client_objects
  using gin ((public.normalize_search_text(street)) extensions.gin_trgm_ops);

create index if not exists client_objects_search_city_trgm_idx
  on public.client_objects
  using gin ((public.normalize_search_text(city)) extensions.gin_trgm_ops);

create index if not exists client_objects_search_blob_trgm_idx
  on public.client_objects
  using gin ((
    public.normalize_search_text(
      coalesce(name, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(street, '') || ' ' ||
      coalesce(house, '') || ' ' ||
      coalesce(apartment, '') || ' ' ||
      coalesce(office, '') || ' ' ||
      coalesce(entrance, '') || ' ' ||
      coalesce(postal_code, '')
    )
  ) extensions.gin_trgm_ops);

create index if not exists client_objects_search_house_idx
  on public.client_objects (company_id, (public.normalize_search_token(house)));

create or replace function public.search_company_objects_for_order(
  p_query text default '',
  p_street text default '',
  p_house text default '',
  p_city text default '',
  p_client_id uuid default null,
  p_limit integer default 8
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
  office text,
  floor text,
  entrance text,
  apartment text,
  entrance_info text,
  parking_notes text,
  geo_lat text,
  geo_lng text
)
language sql
stable
set search_path = public, extensions
as $$
  with input as (
    select
      public.normalize_search_text(p_query) as norm_query,
      public.normalize_search_text(p_street) as norm_street,
      public.normalize_search_text(p_city) as norm_city,
      public.normalize_search_token(p_house) as norm_house,
      greatest(1, least(coalesce(p_limit, 8), 12)) as safe_limit,
      p_client_id as preferred_client_id
  ),
  source as (
    select
      co.id as object_id,
      co.client_id,
      co.name as object_name,
      c.full_name as client_name,
      trim(concat_ws(', ', nullif(co.city, ''), nullif(co.street, ''), nullif(co.house, ''))) as short_address,
      co.country,
      co.region,
      co.district,
      co.city,
      co.street,
      co.house,
      co.postal_code,
      co.office,
      co.floor,
      co.entrance,
      co.apartment,
      co.entrance_info,
      co.parking_notes,
      co.geo_lat,
      co.geo_lng,
      public.normalize_search_text(co.street) as norm_street,
      public.normalize_search_text(co.city) as norm_city,
      public.normalize_search_token(co.house) as norm_house,
      public.normalize_search_text(
        concat_ws(
          ' ',
          coalesce(co.name, ''),
          coalesce(c.full_name, ''),
          coalesce(co.city, ''),
          coalesce(co.street, ''),
          coalesce(co.house, ''),
          coalesce(co.apartment, ''),
          coalesce(co.office, ''),
          coalesce(co.entrance, ''),
          coalesce(co.postal_code, '')
        )
      ) as norm_blob
    from public.client_objects co
    join public.clients c on c.id = co.client_id
    where co.company_id = public.user_company_id()
  ),
  ranked as (
    select
      s.*,
      i.preferred_client_id,
      case
        when i.norm_house = '' then 0.12
        when s.norm_house = i.norm_house then 1.0
        when s.norm_house like i.norm_house || '%' or i.norm_house like s.norm_house || '%' then 0.72
        else 0.0
      end as house_score,
      case
        when i.norm_street = '' then 0.0
        else greatest(similarity(s.norm_street, i.norm_street), word_similarity(s.norm_street, i.norm_street))
      end as street_score,
      case
        when i.norm_city = '' then 0.18
        else greatest(similarity(s.norm_city, i.norm_city), word_similarity(s.norm_city, i.norm_city))
      end as city_score,
      case
        when i.norm_query = '' then 0.0
        else greatest(similarity(s.norm_blob, i.norm_query), word_similarity(s.norm_blob, i.norm_query))
      end as query_score
    from source s
    cross join input i
    where (i.norm_query <> '' or i.norm_street <> '' or i.norm_house <> '')
      and (
        (i.norm_house <> '' and (s.norm_house = i.norm_house or s.norm_house like i.norm_house || '%' or i.norm_house like s.norm_house || '%'))
        or (i.norm_street <> '' and greatest(similarity(s.norm_street, i.norm_street), word_similarity(s.norm_street, i.norm_street)) >= 0.42)
        or (i.norm_query <> '' and greatest(similarity(s.norm_blob, i.norm_query), word_similarity(s.norm_blob, i.norm_query)) >= 0.36)
      )
  ),
  scored as (
    select
      r.*,
      (
        r.house_score * 0.34 +
        r.street_score * 0.36 +
        r.city_score * 0.10 +
        r.query_score * 0.12 +
        case when r.preferred_client_id is not null and r.client_id = r.preferred_client_id then 0.08 else 0 end
      )::real as score,
      (r.preferred_client_id is not null and r.client_id = r.preferred_client_id) as is_same_client
    from ranked r
  )
  select
    s.object_id,
    s.client_id,
    s.object_name,
    s.client_name,
    s.short_address,
    s.score,
    s.is_same_client,
    s.country,
    s.region,
    s.district,
    s.city,
    s.street,
    s.house,
    s.postal_code,
    s.office,
    s.floor,
    s.entrance,
    s.apartment,
    s.entrance_info,
    s.parking_notes,
    s.geo_lat,
    s.geo_lng
  from scored s
  cross join input i
  where s.score >= case when i.norm_street <> '' and i.norm_house <> '' then 0.44 else 0.52 end
  order by
    s.score desc,
    s.is_same_client desc,
    s.object_name asc,
    s.object_id asc
  limit (select safe_limit from input);
$$;

grant execute on function public.search_company_objects_for_order(text, text, text, text, uuid, integer) to authenticated;
