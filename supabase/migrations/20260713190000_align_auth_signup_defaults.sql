begin;

create or replace function public.bootstrap_profile_company_on_auth_signup()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_source text := lower(coalesce(meta->>'registration_source', ''));
  v_account_type text := lower(coalesce(meta->>'account_type', 'solo'));
  v_first text;
  v_last text;
  v_full text;
  v_email text;
  v_company_id uuid;
  v_company_name text;
  v_tz text;
  v_owner_set boolean := false;
begin
  if v_source = 'edge_register_user' then
    return new;
  end if;

  if coalesce(new.confirmed_at, new.email_confirmed_at, new.phone_confirmed_at) is null then
    return new;
  end if;

  if exists (select 1 from public.profiles p where p.id = new.id) then
    return new;
  end if;

  v_first := nullif(trim(coalesce(meta->>'first_name', '')), '');
  v_last := nullif(trim(coalesce(meta->>'last_name', '')), '');
  v_full := nullif(trim(coalesce(meta->>'full_name', concat_ws(' ', v_first, v_last))), '');
  v_email := lower(coalesce(new.email, meta->>'email'));

  begin
    v_company_id := nullif(meta->>'company_id', '')::uuid;
  exception when others then
    v_company_id := null;
  end;

  v_company_name := nullif(trim(coalesce(meta->>'company_name', '')), '');
  if v_company_name is null then
    v_company_name := U&'\041C\043E\044F \043A\043E\043C\043F\0430\043D\0438\044F';
  end if;

  v_tz := nullif(trim(coalesce(meta->>'timezone', '')), '');
  if v_tz is null then
    v_tz := 'UTC';
  end if;

  if v_company_id is null then
    begin
      insert into public.companies(name, timezone, owner_id)
      values (v_company_name, v_tz, new.id)
      returning id into v_company_id;
      v_owner_set := true;
    exception when foreign_key_violation then
      insert into public.companies(name, timezone)
      values (v_company_name, v_tz)
      returning id into v_company_id;
      v_owner_set := false;
    end;
  end if;

  insert into public.profiles (id, email, first_name, last_name, full_name, role, company_id)
  values (new.id, v_email, v_first, v_last, v_full, 'admin', v_company_id)
  on conflict (id) do update
    set email = excluded.email,
        first_name = coalesce(excluded.first_name, public.profiles.first_name),
        last_name = coalesce(excluded.last_name, public.profiles.last_name),
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        role = 'admin',
        company_id = coalesce(public.profiles.company_id, excluded.company_id);

  if v_company_id is not null and not v_owner_set then
    begin
      update public.companies set owner_id = new.id where id = v_company_id and owner_id is null;
    exception when others then
      null;
    end;
  end if;

  if v_company_id is not null then
    begin
      perform public.ensure_company_subscription(v_company_id);
    exception when others then
      null;
    end;
  end if;

  return new;
end;
$function$;

commit;
