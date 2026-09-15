begin;

alter table public.registration_email_codes
  drop constraint if exists registration_email_codes_purpose_check;
alter table public.registration_email_codes
  add constraint registration_email_codes_purpose_check
  check (purpose in ('register', 'recovery', 'email_change_old', 'email_change_new', 'account_deletion'));

alter table public.registration_email_proofs
  drop constraint if exists registration_email_proofs_purpose_check;
alter table public.registration_email_proofs
  add constraint registration_email_proofs_purpose_check
  check (purpose in ('register', 'recovery', 'email_change_old', 'email_change_new', 'account_deletion'));

alter table public.account_deletion_requests
  add column if not exists requested_user_id uuid,
  add column if not exists requested_company_id uuid,
  add column if not exists email_verified_at timestamptz,
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists next_processing_at timestamptz,
  add column if not exists processing_locked_at timestamptz,
  add column if not exists processing_worker text,
  add column if not exists last_processing_error text;

update public.account_deletion_requests
set requested_user_id = coalesce(requested_user_id, user_id),
    requested_company_id = coalesce(requested_company_id, company_id)
where requested_user_id is null
   or requested_company_id is null;

create or replace function public.account_deletion_requests_preserve_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' then
    new.requested_user_id := null;
    new.requested_company_id := null;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.requested_user_id := coalesce(new.requested_user_id, new.user_id);
    new.requested_company_id := coalesce(new.requested_company_id, new.company_id);
  else
    new.requested_user_id := coalesce(old.requested_user_id, new.requested_user_id, new.user_id);
    new.requested_company_id := coalesce(old.requested_company_id, new.requested_company_id, new.company_id);
  end if;
  return new;
end;
$$;

revoke all on function public.account_deletion_requests_preserve_identity()
  from public, anon, authenticated;

drop trigger if exists account_deletion_requests_preserve_identity
  on public.account_deletion_requests;
create trigger account_deletion_requests_preserve_identity
before insert or update on public.account_deletion_requests
for each row
execute function public.account_deletion_requests_preserve_identity();

update public.account_deletion_requests
set requested_user_id = null,
    requested_company_id = null
where status = 'completed'
  and (requested_user_id is not null or requested_company_id is not null);

alter table public.account_deletion_requests
  drop constraint if exists account_deletion_requests_processing_attempts_check;
alter table public.account_deletion_requests
  add constraint account_deletion_requests_processing_attempts_check
  check (processing_attempts >= 0);

create index if not exists account_deletion_requests_processing_queue_idx
  on public.account_deletion_requests (next_processing_at, requested_at)
  where status = 'processing' and email_verified_at is not null and requested_user_id is not null;

create or replace function public.mark_account_deletion_email_verified(
  p_request_id uuid,
  p_user_id uuid
)
returns table (
  request_id uuid,
  request_status text,
  verified_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.account_deletion_requests%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  update public.account_deletion_requests r
  set status = 'processing',
      email_verified_at = coalesce(r.email_verified_at, now()),
      next_processing_at = now(),
      processing_locked_at = null,
      processing_worker = null,
      last_processing_error = null
  where r.id = p_request_id
    and coalesce(r.requested_user_id, r.user_id) = p_user_id
    and r.status = 'pending'
  returning r.* into v_request;

  if v_request.id is null then
    select r.*
    into v_request
    from public.account_deletion_requests r
    where r.id = p_request_id
      and coalesce(r.requested_user_id, r.user_id) = p_user_id
      and r.status = 'processing'
      and r.email_verified_at is not null
    limit 1;
  end if;

  if v_request.id is null then
    raise exception using errcode = '40001', message = 'ACCOUNT_DELETION_REQUEST_STATE_CHANGED';
  end if;

  return query select v_request.id, v_request.status, v_request.email_verified_at;
end;
$$;

revoke all on function public.mark_account_deletion_email_verified(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_account_deletion_email_verified(uuid, uuid)
  to service_role;

create or replace function public.claim_verified_account_deletions(
  p_limit integer default 5,
  p_worker text default null,
  p_lock_seconds integer default 300
)
returns table (
  request_id uuid,
  user_id uuid,
  company_id uuid,
  requested_email text,
  processing_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  return query
  with picked as (
    select r.id
    from public.account_deletion_requests r
    where r.status = 'processing'
      and r.email_verified_at is not null
      and r.requested_user_id is not null
      and coalesce(r.next_processing_at, r.email_verified_at) <= now()
      and (
        r.processing_locked_at is null
        or r.processing_locked_at < now() - make_interval(secs => greatest(30, least(coalesce(p_lock_seconds, 300), 3600)))
      )
    order by coalesce(r.next_processing_at, r.email_verified_at), r.requested_at, r.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 25))
  ), claimed as (
    update public.account_deletion_requests r
    set processing_locked_at = now(),
        processing_worker = nullif(left(trim(coalesce(p_worker, '')), 160), ''),
        processing_attempts = r.processing_attempts + 1,
        last_processing_error = null
    from picked
    where r.id = picked.id
    returning r.*
  )
  select c.id, c.requested_user_id, c.requested_company_id, c.requested_email, c.processing_attempts
  from claimed c;
end;
$$;

revoke all on function public.claim_verified_account_deletions(integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_verified_account_deletions(integer, text, integer)
  to service_role;

create or replace function public.release_verified_account_deletion(
  p_request_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  update public.account_deletion_requests r
  set processing_locked_at = null,
      processing_worker = null,
      last_processing_error = left(coalesce(nullif(trim(p_error), ''), 'ACCOUNT_DELETION_PROCESSING_FAILED'), 2000),
      next_processing_at = now() + make_interval(
        secs => least(3600, 30 * (2 ^ least(greatest(r.processing_attempts - 1, 0), 7))::integer)
      )
  where r.id = p_request_id
    and r.status = 'processing';
end;
$$;

revoke all on function public.release_verified_account_deletion(uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_verified_account_deletion(uuid, text)
  to service_role;

create or replace function public.list_account_deletion_storage_objects(
  p_user_ids uuid[]
)
returns table (
  bucket_id text,
  object_name text
)
language sql
security definer
set search_path = ''
as $$
  select o.bucket_id::text, o.name::text
  from storage.objects o
  where o.owner = any(coalesce(p_user_ids, array[]::uuid[]))
     or o.owner_id = any(
       select user_id::text
       from unnest(coalesce(p_user_ids, array[]::uuid[])) as ids(user_id)
     )
  order by o.bucket_id, o.name;
$$;

revoke all on function public.list_account_deletion_storage_objects(uuid[])
  from public, anon, authenticated;
grant execute on function public.list_account_deletion_storage_objects(uuid[])
  to service_role;

create or replace function public.cancel_my_account_deletion_request(
  p_request_id uuid default null
)
returns table (
  request_id uuid,
  request_status text,
  request_updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.account_deletion_requests%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select * into v_request
  from public.account_deletion_requests r
  where r.user_id = v_user_id
    and r.status = 'pending'
    and (p_request_id is null or r.id = p_request_id)
  order by r.requested_at desc
  limit 1
  for update;

  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_DELETION_REQUEST_NOT_CANCELLABLE';
  end if;

  update public.account_deletion_requests r
  set status = 'cancelled', updated_at = now()
  where r.id = v_request.id
    and r.status = 'pending'
  returning r.* into v_request;

  if v_request.id is null then
    raise exception using errcode = '40001', message = 'ACCOUNT_DELETION_REQUEST_STATE_CHANGED';
  end if;

  if v_request.feedback_id is not null then
    update public.feedbacks f
    set text = concat(
      coalesce(f.text, ''), E'\n',
      '[ACCOUNT_DELETION_REQUEST_CANCELLED_V1]', E'\n',
      'Cancelled by the authenticated user at: ', now()::text
    )
    where f.id = v_request.feedback_id;
  end if;

  return query select v_request.id, v_request.status, v_request.updated_at;
end;
$$;

revoke all on function public.cancel_my_account_deletion_request(uuid) from public, anon;
grant execute on function public.cancel_my_account_deletion_request(uuid)
  to authenticated, service_role;

commit;
