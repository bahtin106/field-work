begin;

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  requested_email text,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  confirmation_sent_at timestamptz,
  feedback_id uuid references public.feedbacks(id) on delete set null,
  constraint account_deletion_requests_status_check
    check (status in ('pending', 'processing', 'completed', 'cancelled', 'rejected')),
  constraint account_deletion_requests_completion_check
    check (
      (status = 'completed' and completed_at is not null)
      or (status <> 'completed' and completed_at is null)
    ),
  constraint account_deletion_requests_confirmation_check
    check (
      (status = 'completed' and confirmation_sent_at is not null)
      or (status <> 'completed' and confirmation_sent_at is null)
    )
);

comment on table public.account_deletion_requests is
  'Authoritative queue of authenticated whole-account deletion requests initiated in the app.';
comment on column public.account_deletion_requests.requested_email is
  'Email snapshot retained for completion confirmation after the auth/profile row is removed.';
comment on column public.account_deletion_requests.feedback_id is
  'Internal support notification linked to the authoritative deletion request.';

create unique index if not exists account_deletion_requests_one_active_per_user_uidx
  on public.account_deletion_requests (user_id)
  where user_id is not null and status in ('pending', 'processing');

create index if not exists account_deletion_requests_status_requested_at_idx
  on public.account_deletion_requests (status, requested_at);

alter table public.account_deletion_requests enable row level security;

drop policy if exists account_deletion_requests_select_own on public.account_deletion_requests;
create policy account_deletion_requests_select_own
on public.account_deletion_requests
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists account_deletion_requests_select_super_admin on public.account_deletion_requests;
create policy account_deletion_requests_select_super_admin
on public.account_deletion_requests
for select
to authenticated
using ((select public.is_super_admin()));

revoke all on table public.account_deletion_requests from public, anon, authenticated;
revoke all on table public.account_deletion_requests from service_role;
grant select on table public.account_deletion_requests to authenticated, service_role;

create or replace function public.account_deletion_requests_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.account_deletion_requests_set_updated_at() from public, anon, authenticated;

drop trigger if exists account_deletion_requests_set_updated_at
  on public.account_deletion_requests;
create trigger account_deletion_requests_set_updated_at
before update on public.account_deletion_requests
for each row
execute function public.account_deletion_requests_set_updated_at();

create or replace function public.account_deletion_requests_preserve_active_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('pending', 'processing') then
    return null;
  end if;

  return old;
end;
$$;

comment on function public.account_deletion_requests_preserve_active_delete() is
  'Makes generic cleanup DELETE a no-op for active privacy requests so their lifecycle can be completed.';

revoke all on function public.account_deletion_requests_preserve_active_delete()
  from public, anon, authenticated;

drop trigger if exists account_deletion_requests_preserve_active_delete
  on public.account_deletion_requests;
create trigger account_deletion_requests_preserve_active_delete
before delete on public.account_deletion_requests
for each row
execute function public.account_deletion_requests_preserve_active_delete();

create or replace function public.request_account_deletion()
returns table (
  request_id uuid,
  request_status text,
  requested_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_email text;
  v_full_name text;
  v_request public.account_deletion_requests%rowtype;
  v_feedback_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select
    p.company_id,
    nullif(
      left(
        coalesce(
          nullif(trim(p.email), ''),
          nullif(trim(auth.jwt() ->> 'email'), ''),
          ''
        ),
        320
      ),
      ''
    ),
    nullif(left(trim(coalesce(p.full_name, '')), 240), '')
  into v_company_id, v_email, v_full_name
  from public.profiles p
  where p.id = v_user_id
  limit 1;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND';
  end if;

  insert into public.account_deletion_requests (
    user_id,
    company_id,
    requested_email
  )
  values (
    v_user_id,
    v_company_id,
    v_email
  )
  on conflict do nothing
  returning * into v_request;

  select r.*
  into v_request
  from public.account_deletion_requests r
  where r.user_id = v_user_id
    and r.status in ('pending', 'processing')
  order by r.requested_at desc
  limit 1
  for update;

  if v_request.id is null then
    raise exception using errcode = '40001', message = 'ACCOUNT_DELETION_REQUEST_RETRY';
  end if;

  if v_request.feedback_id is null then
    insert into public.feedbacks (
      user_id,
      company_id,
      contact,
      full_name,
      text
    )
    values (
      v_user_id,
      v_company_id,
      v_email,
      v_full_name,
      concat(
        '[ACCOUNT_DELETION_REQUEST_V1]', E'\n',
        'Dedicated request ID: ', v_request.id::text, E'\n',
        'Authenticated user requested deletion of the entire account and associated personal data.', E'\n',
        'Requested at: ', v_request.requested_at::text
      )
    )
    returning id into v_feedback_id;

    update public.account_deletion_requests r
    set feedback_id = v_feedback_id,
        updated_at = now()
    where r.id = v_request.id
      and r.feedback_id is null;
  end if;

  return query
  select r.id, r.status, r.requested_at
  from public.account_deletion_requests r
  where r.id = v_request.id;
end;
$$;

revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated, service_role;

create or replace function public.transition_account_deletion_request(
  p_request_id uuid,
  p_expected_status text,
  p_next_status text,
  p_confirmation_sent_at timestamptz
)
returns table (
  request_id uuid,
  previous_status text,
  request_status text,
  request_updated_at timestamptz
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

  if not (
    (p_expected_status = 'pending' and p_next_status in ('processing', 'cancelled', 'rejected'))
    or
    (p_expected_status = 'processing' and p_next_status in ('pending', 'completed', 'cancelled', 'rejected'))
  ) then
    raise exception using errcode = '22023', message = 'INVALID_ACCOUNT_DELETION_TRANSITION';
  end if;

  if (p_next_status = 'completed') <> (p_confirmation_sent_at is not null) then
    raise exception using errcode = '22023', message = 'CONFIRMATION_TIMESTAMP_REQUIRED_FOR_COMPLETION';
  end if;

  if p_confirmation_sent_at is not null and p_confirmation_sent_at > now() then
    raise exception using errcode = '22023', message = 'CONFIRMATION_TIMESTAMP_CANNOT_BE_IN_FUTURE';
  end if;

  update public.account_deletion_requests r
  set status = p_next_status,
      completed_at = case when p_next_status = 'completed' then now() else null end,
      confirmation_sent_at = p_confirmation_sent_at,
      requested_email = case when p_next_status = 'completed' then null else r.requested_email end,
      user_id = case when p_next_status = 'completed' then null else r.user_id end,
      company_id = case when p_next_status = 'completed' then null else r.company_id end
  where r.id = p_request_id
    and r.status = p_expected_status
    and (p_next_status <> 'completed' or r.user_id is null)
  returning r.* into v_request;

  if v_request.id is null then
    raise exception using errcode = '40001', message = 'ACCOUNT_DELETION_REQUEST_STATE_CHANGED';
  end if;

  if p_next_status = 'completed' and v_request.feedback_id is not null then
    update public.feedbacks f
    set user_id = null,
        company_id = null,
        contact = null,
        full_name = null,
        status = 'completed',
        status_updated_at = now(),
        status_updated_by = null
    where f.id = v_request.feedback_id;

    if exists (
      select 1
      from public.feedbacks f
      where f.id = v_request.feedback_id
        and (
          f.user_id is not null
          or f.company_id is not null
          or f.contact is not null
          or f.full_name is not null
        )
    ) then
      raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETION_FEEDBACK_PII_NOT_CLEARED';
    end if;
  end if;

  return query
  select
    v_request.id,
    p_expected_status,
    v_request.status,
    v_request.updated_at;
end;
$$;

revoke all on function public.transition_account_deletion_request(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.transition_account_deletion_request(uuid, text, text, timestamptz)
  to service_role;

commit;
