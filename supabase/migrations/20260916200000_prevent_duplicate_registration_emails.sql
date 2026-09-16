begin;

do $duplicates$
begin
  if exists (
    select 1
    from public.profiles
    where nullif(btrim(email), '') is not null
    group by lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception 'PROFILE_EMAIL_DUPLICATES_EXIST'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from auth.users
    where nullif(btrim(email), '') is not null
      and not coalesce(is_sso_user, false)
    group by lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception 'AUTH_EMAIL_DUPLICATES_EXIST'
      using errcode = '23505';
  end if;
end
$duplicates$;

create unique index if not exists profiles_email_normalized_uidx
  on public.profiles (lower(btrim(email)))
  where nullif(btrim(email), '') is not null;

create unique index if not exists users_email_normalized_uidx
  on auth.users (lower(btrim(email)))
  where nullif(btrim(email), '') is not null
    and not coalesce(is_sso_user, false);

create or replace function public.service_rollback_failed_registration(
  p_user_id uuid,
  p_company_id uuid default null,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, storage
as $function$
declare
  r record;
  v_auth_created_at timestamptz := null;
  v_auth_email text := null;
  v_last_sign_in_at timestamptz := null;
  v_invited_at timestamptz := null;
  v_registration_source text := '';
  v_account_type text := '';
  v_expected_email text := lower(nullif(btrim(p_email), ''));
  v_count bigint := 0;
begin
  if p_user_id is null then
    raise exception 'ROLLBACK_USER_ID_REQUIRED'
      using errcode = '22023';
  end if;

  select
    u.created_at,
    lower(nullif(btrim(u.email), '')),
    u.last_sign_in_at,
    u.invited_at,
    lower(coalesce(u.raw_user_meta_data ->> 'registration_source', '')),
    lower(coalesce(u.raw_user_meta_data ->> 'account_type', ''))
  into
    v_auth_created_at,
    v_auth_email,
    v_last_sign_in_at,
    v_invited_at,
    v_registration_source,
    v_account_type
  from auth.users u
  where u.id = p_user_id
  for update;

  if found then
    if v_expected_email is not null and v_auth_email is distinct from v_expected_email then
      raise exception 'ROLLBACK_EMAIL_MISMATCH'
        using errcode = '23514';
    end if;
    if v_last_sign_in_at is not null then
      raise exception 'ROLLBACK_SIGNED_IN_USER_FORBIDDEN'
        using errcode = '23514';
    end if;
    if v_registration_source <> 'edge_register_user'
       and not (
         v_registration_source = ''
         and v_invited_at is null
         and v_account_type in ('solo', 'company')
       )
    then
      raise exception 'ROLLBACK_REGISTRATION_SOURCE_FORBIDDEN'
        using errcode = '23514';
    end if;
  elsif not exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and (
        v_expected_email is null
        or lower(nullif(btrim(p.email), '')) = v_expected_email
      )
  ) then
    return jsonb_build_object(
      'ok', true,
      'already_absent', true,
      'deleted_users', 0,
      'deleted_companies', 0
    );
  end if;

  create temp table _registration_rollback_users(
    id uuid primary key
  ) on commit drop;
  insert into _registration_rollback_users(id) values (p_user_id);

  create temp table _registration_rollback_companies(
    id uuid primary key
  ) on commit drop;

  if p_company_id is not null then
    insert into _registration_rollback_companies(id)
    select c.id
    from public.companies c
    where c.id = p_company_id
      and (
        c.owner_id = p_user_id
        or exists (
          select 1
          from public.profiles p
          where p.id = p_user_id
            and p.company_id = c.id
        )
        or (
          c.owner_id is null
          and not exists (
            select 1
            from public.profiles p
            where p.company_id = c.id
          )
        )
      )
      and not exists (
        select 1
        from public.profiles p
        where p.company_id = c.id
          and p.id <> p_user_id
      );

    if not found then
      raise exception 'ROLLBACK_COMPANY_OWNERSHIP_MISMATCH'
        using errcode = '23514';
    end if;
  end if;

  insert into _registration_rollback_companies(id)
  select distinct c.id
  from public.companies c
  where c.owner_id = p_user_id
    and c.created_at >= coalesce(v_auth_created_at - interval '5 minutes', now() - interval '1 hour')
    and not exists (
      select 1
      from public.profiles p
      where p.company_id = c.id
        and p.id <> p_user_id
    )
  on conflict do nothing;

  insert into _registration_rollback_companies(id)
  select distinct p.company_id
  from public.profiles p
  where p.id = p_user_id
    and p.company_id is not null
    and not exists (
      select 1
      from public.profiles other_profile
      where other_profile.company_id = p.company_id
        and other_profile.id <> p_user_id
    )
  on conflict do nothing;

  select count(*) into v_count
  from _registration_rollback_companies;

  perform set_config('app.trash_hard_delete', 'on', true);
  perform set_config('app.company_deletion_in_progress', '1', true);

  if to_regclass('public.finance_entry_media_external_map') is not null then
    delete from public.finance_entry_media_external_map
    where company_id in (select id from _registration_rollback_companies);
  end if;

  if to_regclass('public.order_media_external_map') is not null then
    delete from public.order_media_external_map
    where company_id in (select id from _registration_rollback_companies);
  end if;

  delete from public.orders
  where company_id in (select id from _registration_rollback_companies);

  if to_regclass('public.profile_media_external_map') is not null then
    delete from public.profile_media_external_map
    where company_id in (select id from _registration_rollback_companies)
      and entity_type in ('feedback_attachment', 'feedback');
  end if;

  for r in
    select c.table_schema, c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'company_id'
      and c.table_name not in ('account_deletion_requests', 'profiles')
      and t.table_type = 'BASE TABLE'
    group by c.table_schema, c.table_name
  loop
    begin
      execute format(
        'delete from %I.%I where company_id in (select id from _registration_rollback_companies)',
        r.table_schema,
        r.table_name
      );
    exception
      when insufficient_privilege then
        raise notice 'skip table %.%: insufficient_privilege', r.table_schema, r.table_name;
    end;
  end loop;

  for r in
    select c.table_schema, c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.table_name not in ('account_deletion_requests', 'companies', 'profiles')
      and c.column_name in (
        'user_id', 'owner_id', 'created_by', 'created_by_user_id', 'assigned_to',
        'destination_user_id', 'recipient_user_id', 'actor_user_id', 'profile_id',
        'employee_id', 'manager_id', 'author_id', 'requested_by', 'changed_by'
      )
      and c.udt_name = 'uuid'
      and t.table_type = 'BASE TABLE'
  loop
    begin
      execute format(
        'delete from %I.%I where %I in (select id from _registration_rollback_users)',
        r.table_schema,
        r.table_name,
        r.column_name
      );
    exception
      when insufficient_privilege then
        raise notice 'skip table %.% (%): insufficient_privilege',
          r.table_schema, r.table_name, r.column_name;
    end;
  end loop;

  for r in
    select c.table_schema, c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
    where c.table_schema = 'auth'
      and c.column_name = 'user_id'
      and c.udt_name = 'uuid'
      and t.table_type = 'BASE TABLE'
  loop
    begin
      execute format(
        'delete from %I.%I where %I in (select id from _registration_rollback_users)',
        r.table_schema,
        r.table_name,
        r.column_name
      );
    exception
      when insufficient_privilege then
        raise notice 'skip table %.% (%): insufficient_privilege',
          r.table_schema, r.table_name, r.column_name;
    end;
  end loop;

  delete from auth.refresh_tokens
  where user_id = p_user_id::text;

  if v_expected_email is not null then
    if to_regclass('public.registration_email_codes') is not null then
      delete from public.registration_email_codes
      where lower(btrim(email)) = v_expected_email;
    end if;

    if to_regclass('public.registration_email_proofs') is not null then
      delete from public.registration_email_proofs
      where lower(btrim(email)) = v_expected_email;
    end if;
  end if;

  delete from public.companies
  where id in (select id from _registration_rollback_companies);

  delete from public.profiles
  where id = p_user_id;

  delete from storage.objects
  where owner = p_user_id
     or owner_id = p_user_id::text;

  delete from auth.users
  where id = p_user_id;

  if exists (select 1 from public.profiles where id = p_user_id)
     or exists (select 1 from auth.users where id = p_user_id)
     or exists (
       select 1
       from public.companies
       where id in (select id from _registration_rollback_companies)
     )
  then
    raise exception 'ROLLBACK_INCOMPLETE';
  end if;

  return jsonb_build_object(
    'ok', true,
    'already_absent', false,
    'deleted_users', 1,
    'deleted_companies', v_count
  );
end;
$function$;

revoke all on function public.service_rollback_failed_registration(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_rollback_failed_registration(uuid, uuid, text)
  to service_role;

commit;
