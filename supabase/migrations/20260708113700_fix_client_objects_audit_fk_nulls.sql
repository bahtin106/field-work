create or replace function public.client_objects_sync_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company_id uuid;
  v_actor_id uuid;
  v_updated_by_cleared boolean := false;
begin
  select c.company_id
    into v_company_id
    from public.clients c
   where c.id = new.client_id;

  if v_company_id is null then
    raise exception 'client % not found for object', new.client_id using errcode = '23503';
  end if;

  v_actor_id := auth.uid();
  if tg_op = 'UPDATE' then
    v_updated_by_cleared := old.updated_by is not null
      and new.updated_by is null
      and v_actor_id is null;
  end if;

  new.company_id := v_company_id;
  new.name := coalesce(nullif(btrim(coalesce(new.name, '')), ''), U&'\041d\043e\0432\044b\0439 \043e\0431\044a\0435\043a\0442');
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
  new.comment := nullif(btrim(coalesce(new.comment, '')), '');
  new.geo_lat := nullif(btrim(coalesce(new.geo_lat, '')), '');
  new.geo_lng := nullif(btrim(coalesce(new.geo_lng, '')), '');
  new.additional_phone_1 := nullif(btrim(coalesce(new.additional_phone_1, '')), '');
  new.additional_phone_1_label := nullif(left(btrim(coalesce(new.additional_phone_1_label, '')), 48), '');
  new.additional_phone_2 := nullif(btrim(coalesce(new.additional_phone_2, '')), '');
  new.additional_phone_2_label := nullif(left(btrim(coalesce(new.additional_phone_2_label, '')), 48), '');
  new.additional_phone_3 := nullif(btrim(coalesce(new.additional_phone_3, '')), '');
  new.additional_phone_3_label := nullif(left(btrim(coalesce(new.additional_phone_3_label, '')), 48), '');

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
  if tg_op = 'INSERT' then
    new.updated_by := coalesce(v_actor_id, new.updated_by, new.created_by);
  elsif v_updated_by_cleared then
    new.updated_by := null;
  else
    new.updated_by := coalesce(v_actor_id, new.updated_by, old.updated_by);
  end if;

  return new;
end
$function$;
