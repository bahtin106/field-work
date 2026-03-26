begin;

-- Enforce at most one primary object per client.
create unique index if not exists client_objects_one_primary_per_client_idx
  on public.client_objects (client_id)
  where is_primary;

-- Backfill: for any client that has objects but no primary, mark the oldest as primary.
with missing_primary_clients as (
  select co.client_id
    from public.client_objects co
   group by co.client_id
  having bool_or(coalesce(co.is_primary, false)) = false
), ranked as (
  select
    co.id,
    co.client_id,
    row_number() over (
      partition by co.client_id
      order by co.created_at asc, co.id asc
    ) as rn
  from public.client_objects co
  join missing_primary_clients mpc
    on mpc.client_id = co.client_id
), dedup as (
  select r.id
  from ranked r
  where r.rn = 1
)
update public.client_objects co
   set is_primary = true,
       updated_at = timezone('utc'::text, now()),
       updated_by = coalesce(auth.uid(), co.updated_by)
  from dedup d
 where co.id = d.id;

-- Guardrails in sync trigger:
-- 1) first object auto-becomes primary;
-- 2) last primary cannot be unset by update;
-- 3) setting one object primary demotes others.
create or replace function public.client_objects_sync_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_actor_id uuid;
begin
  select c.company_id
    into v_company_id
    from public.clients c
   where c.id = new.client_id;

  if v_company_id is null then
    raise exception 'client % not found for object', new.client_id using errcode = '23503';
  end if;

  v_actor_id := auth.uid();

  new.company_id := v_company_id;
  new.name := coalesce(nullif(btrim(coalesce(new.name, '')), ''), 'Новый объект');
  new.country := nullif(btrim(coalesce(new.country, '')), '');
  new.region := nullif(btrim(coalesce(new.region, '')), '');
  new.district := nullif(btrim(coalesce(new.district, '')), '');
  new.city := nullif(btrim(coalesce(new.city, '')), '');
  new.street := nullif(btrim(coalesce(new.street, '')), '');
  new.house := nullif(btrim(coalesce(new.house, '')), '');
  new.postal_code := nullif(btrim(coalesce(new.postal_code, '')), '');
  new.floor := nullif(btrim(coalesce(new.floor, '')), '');
  new.entrance := nullif(btrim(coalesce(new.entrance, '')), '');
  new.apartment := nullif(btrim(coalesce(new.apartment, '')), '');
  new.comment := coalesce(
    nullif(btrim(coalesce(new.comment, '')), ''),
    nullif(btrim(coalesce(new.entrance_info, '')), '')
  );
  new.entrance_info := new.comment;
  new.geo_lat := nullif(btrim(coalesce(new.geo_lat, '')), '');
  new.geo_lng := nullif(btrim(coalesce(new.geo_lng, '')), '');
  new.additional_phone_1 := nullif(btrim(coalesce(new.additional_phone_1, '')), '');
  new.additional_phone_1_label := nullif(left(btrim(coalesce(new.additional_phone_1_label, '')), 48), '');
  new.additional_phone_2 := nullif(btrim(coalesce(new.additional_phone_2, '')), '');
  new.additional_phone_2_label := nullif(left(btrim(coalesce(new.additional_phone_2_label, '')), 48), '');
  new.additional_phone_3 := nullif(btrim(coalesce(new.additional_phone_3, '')), '');
  new.additional_phone_3_label := nullif(left(btrim(coalesce(new.additional_phone_3_label, '')), 48), '');

  new.summary := public.client_object_summary(
    new.country,
    new.region,
    new.city,
    new.street,
    new.house,
    null,
    new.entrance,
    new.apartment
  );

  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, timezone('utc'::text, now()));
    new.created_by := coalesce(new.created_by, v_actor_id);

    if not exists (
      select 1
        from public.client_objects o
       where o.client_id = new.client_id
         and coalesce(o.is_primary, false)
    ) then
      new.is_primary := true;
    end if;
  end if;

  if tg_op = 'UPDATE'
     and coalesce(old.is_primary, false)
     and not coalesce(new.is_primary, false)
     and not exists (
       select 1
         from public.client_objects o
        where o.client_id = new.client_id
          and o.id <> new.id
          and coalesce(o.is_primary, false)
     ) then
    new.is_primary := true;
  end if;

  if coalesce(new.is_primary, false) then
    if exists (
      select 1
        from public.client_objects o
       where o.client_id = new.client_id
         and o.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(o.is_primary, false)
    ) then
      update public.client_objects
         set is_primary = false,
             updated_at = timezone('utc'::text, now()),
             updated_by = coalesce(v_actor_id, updated_by)
       where client_id = new.client_id
         and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(is_primary, false);
    end if;
  end if;

  new.updated_at := timezone('utc'::text, now());
  new.updated_by := coalesce(v_actor_id, new.updated_by, old.updated_by);

  return new;
end
$$;

-- Normalize comments (ascii-safe, no mojibake risk).
comment on column public.client_objects.apartment is
  'Apartment/office (technical key kept as apartment for backward compatibility)';
comment on column public.client_objects.entrance_info is
  'DEPRECATED compatibility mirror of comment; kept for legacy SQL/view compatibility';
comment on column public.client_objects.summary is
  'Address snapshot for search/listing; maintained by trigger on each insert/update';

commit;
