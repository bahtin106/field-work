begin;

create or replace function public.client_tag_links_guard()
returns trigger
language plpgsql
as $$
declare
  v_client_company_id uuid;
  v_tag_company_id uuid;
  v_tag_type text;
  v_count integer;
begin
  select company_id
    into v_client_company_id
    from public.clients
   where id = new.client_id;

  if v_client_company_id is null then
    raise exception 'client % not found', new.client_id using errcode = '23503';
  end if;

  select company_id, tag_type
    into v_tag_company_id, v_tag_type
    from public.company_tags
   where id = new.tag_id;

  if v_tag_company_id is null then
    raise exception 'tag % not found', new.tag_id using errcode = '23503';
  end if;

  if v_tag_type <> 'client' then
    raise exception 'tag % is not a client tag', new.tag_id using errcode = '22023';
  end if;

  if v_client_company_id <> v_tag_company_id then
    raise exception 'tag/company mismatch' using errcode = '42501';
  end if;

  new.company_id := v_client_company_id;
  new.created_by := coalesce(new.created_by, auth.uid());
  new.created_at := coalesce(new.created_at, now());

  if tg_op = 'INSERT' then
    if exists (
      select 1
      from public.client_tag_links l
      where l.client_id = new.client_id
        and l.tag_id = new.tag_id
    ) then
      return new;
    end if;

    select count(*)::int
      into v_count
      from public.client_tag_links l
     where l.client_id = new.client_id;
  else
    select count(*)::int
      into v_count
      from public.client_tag_links l
     where l.client_id = new.client_id
       and l.tag_id <> old.tag_id;
  end if;

  if v_count >= 10 then
    raise exception 'client can have at most 10 tags' using errcode = '22023';
  end if;

  return new;
end;
$$;

create or replace function public.object_tag_links_guard()
returns trigger
language plpgsql
as $$
declare
  v_object_company_id uuid;
  v_tag_company_id uuid;
  v_tag_type text;
  v_count integer;
begin
  select company_id
    into v_object_company_id
    from public.client_objects
   where id = new.object_id;

  if v_object_company_id is null then
    raise exception 'object % not found', new.object_id using errcode = '23503';
  end if;

  select company_id, tag_type
    into v_tag_company_id, v_tag_type
    from public.company_tags
   where id = new.tag_id;

  if v_tag_company_id is null then
    raise exception 'tag % not found', new.tag_id using errcode = '23503';
  end if;

  if v_tag_type <> 'object' then
    raise exception 'tag % is not an object tag', new.tag_id using errcode = '22023';
  end if;

  if v_object_company_id <> v_tag_company_id then
    raise exception 'tag/company mismatch' using errcode = '42501';
  end if;

  new.company_id := v_object_company_id;
  new.created_by := coalesce(new.created_by, auth.uid());
  new.created_at := coalesce(new.created_at, now());

  if tg_op = 'INSERT' then
    if exists (
      select 1
      from public.object_tag_links l
      where l.object_id = new.object_id
        and l.tag_id = new.tag_id
    ) then
      return new;
    end if;

    select count(*)::int
      into v_count
      from public.object_tag_links l
     where l.object_id = new.object_id;
  else
    select count(*)::int
      into v_count
      from public.object_tag_links l
     where l.object_id = new.object_id
       and l.tag_id <> old.tag_id;
  end if;

  if v_count >= 10 then
    raise exception 'object can have at most 10 tags' using errcode = '22023';
  end if;

  return new;
end;
$$;

commit;

