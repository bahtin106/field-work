-- Client objects hardening:
-- 1) keep apartment technical column but document as "Квартира/офис";
-- 2) keep entrance_info as compatibility alias (comment mirror), do not drop;
-- 3) fix stale summary by recalculation + trigger maintenance;
-- 4) add FK navigation for created_by / updated_by in Supabase Studio.

begin;

-- Keep naming stable in code, but clarify semantic meaning at DB level.
comment on column public.client_objects.apartment is
  'Квартира/офис (technical key kept as apartment for backward compatibility)';
comment on column public.client_objects.entrance_info is
  'DEPRECATED compatibility mirror of comment; kept for legacy SQL/view compatibility';
comment on column public.client_objects.summary is
  'Address snapshot for search/listing; maintained by trigger on each insert/update';

-- Recalculate stale snapshots for existing rows.
update public.client_objects co
set summary = public.client_object_summary(
  co.country,
  co.region,
  co.city,
  co.street,
  co.house,
  null,
  co.entrance,
  co.apartment
)
where co.summary is distinct from public.client_object_summary(
  co.country,
  co.region,
  co.city,
  co.street,
  co.house,
  null,
  co.entrance,
  co.apartment
);

-- Ensure writer trigger keeps summary up to date.
create or replace function public.client_objects_sync_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select c.company_id
    into v_company_id
    from public.clients c
   where c.id = new.client_id;

  if v_company_id is null then
    raise exception 'client % not found for object', new.client_id using errcode = '23503';
  end if;

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
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;

  new.updated_at := timezone('utc'::text, now());
  new.updated_by := auth.uid();

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
             updated_by = auth.uid()
       where client_id = new.client_id
         and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(is_primary, false);
    end if;
  end if;

  return new;
end
$$;

-- FK arrows for quick preview in Supabase Table Editor.
update public.client_objects co
set created_by = null
where co.created_by is not null
  and not exists (select 1 from public.profiles p where p.id = co.created_by);

update public.client_objects co
set updated_by = null
where co.updated_by is not null
  and not exists (select 1 from public.profiles p where p.id = co.updated_by);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_objects_created_by_fkey'
      and conrelid = 'public.client_objects'::regclass
  ) then
    alter table public.client_objects
      add constraint client_objects_created_by_fkey
      foreign key (created_by) references public.profiles(id)
      on delete set null not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_objects_updated_by_fkey'
      and conrelid = 'public.client_objects'::regclass
  ) then
    alter table public.client_objects
      add constraint client_objects_updated_by_fkey
      foreign key (updated_by) references public.profiles(id)
      on delete set null not valid;
  end if;
end
$$;

alter table public.client_objects validate constraint client_objects_created_by_fkey;
alter table public.client_objects validate constraint client_objects_updated_by_fkey;

commit;

