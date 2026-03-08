begin;

create or replace function public.normalize_phone_digits(p_phone text)
returns text
language sql
immutable
as $$
  with raw as (
    select nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '') as digits
  )
  select case
    when digits is null then null
    when length(digits) = 11 and left(digits, 1) = '8' then '7' || substr(digits, 2)
    when length(digits) = 10 then '7' || digits
    when length(digits) = 11 and left(digits, 1) = '7' then digits
    else digits
  end
  from raw;
$$;

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
  new.secondary_phone := nullif(btrim(coalesce(new.secondary_phone, '')), '');
  new.additional_phone_1 := nullif(btrim(coalesce(new.additional_phone_1, '')), '');
  new.additional_phone_1_label := nullif(left(btrim(coalesce(new.additional_phone_1_label, '')), 48), '');
  new.additional_phone_2 := nullif(btrim(coalesce(new.additional_phone_2, '')), '');
  new.additional_phone_2_label := nullif(left(btrim(coalesce(new.additional_phone_2_label, '')), 48), '');
  new.additional_phone_3 := nullif(btrim(coalesce(new.additional_phone_3, '')), '');
  new.additional_phone_3_label := nullif(left(btrim(coalesce(new.additional_phone_3_label, '')), 48), '');

  if new.additional_phone_1 is null and new.secondary_phone is not null then
    new.additional_phone_1 := new.secondary_phone;
  end if;
  new.secondary_phone := new.additional_phone_1;

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

create or replace function public.clients_prevent_primary_phone_duplicates()
returns trigger
language plpgsql
as $$
declare
  v_phone_key text;
  v_old_phone_key text;
  v_conflict_id uuid;
begin
  v_phone_key := public.normalize_phone_digits(new.phone);

  if v_phone_key is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_phone_key := public.normalize_phone_digits(old.phone);
    if v_phone_key is not distinct from v_old_phone_key
       and new.company_id is not distinct from old.company_id then
      return new;
    end if;
  end if;

  select c.id
    into v_conflict_id
  from public.clients c
  where c.company_id = new.company_id
    and public.normalize_phone_digits(c.phone) = v_phone_key
    and (tg_op = 'INSERT' or c.id <> new.id)
  order by c.created_at asc nulls last, c.id asc
  limit 1;

  if v_conflict_id is not null then
    raise exception 'primary phone already used by another client'
      using errcode = '23505', detail = v_conflict_id::text;
  end if;

  return new;
end
$$;

drop trigger if exists trg_clients_prevent_primary_phone_duplicates on public.clients;
create trigger trg_clients_prevent_primary_phone_duplicates
before insert or update of company_id, phone
on public.clients
for each row
execute function public.clients_prevent_primary_phone_duplicates();

create or replace function public.find_client_by_primary_phone(
  p_phone text,
  p_exclude_client_id uuid default null
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  middle_name text,
  full_name text,
  phone text
)
language plpgsql
stable
security invoker
as $$
declare
  v_company_id uuid := user_company_id();
begin
  if v_company_id is null then
    return;
  end if;

  return query
  select
    c.id,
    c.first_name,
    c.last_name,
    c.middle_name,
    c.full_name,
    c.phone
  from public.clients c
  where c.company_id = v_company_id
    and has_app_role_permission(
      c.company_id,
      user_role(),
      'canViewClients',
      clients_permission_default(user_role(), 'canViewClients')
    )
    and public.normalize_phone_digits(c.phone) = public.normalize_phone_digits(p_phone)
    and (p_exclude_client_id is null or c.id <> p_exclude_client_id)
  order by c.updated_at desc nulls last, c.created_at desc nulls last, c.id desc
  limit 1;
end
$$;

grant execute on function public.find_client_by_primary_phone(text, uuid) to authenticated;

commit;
