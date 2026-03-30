begin;

alter table public.media_cleanup_queue
  add column if not exists status text not null default 'pending',
  add column if not exists max_attempts integer not null default 40,
  add column if not exists error_code text,
  add column if not exists first_attempt_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists succeeded_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists dead_letter_at timestamptz,
  add column if not exists lock_expires_at timestamptz,
  add column if not exists claimed_by text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'media_cleanup_queue_status_check'
      and conrelid = 'public.media_cleanup_queue'::regclass
  ) then
    alter table public.media_cleanup_queue
      add constraint media_cleanup_queue_status_check
      check (status in ('pending', 'processing', 'retrying', 'succeeded', 'failed', 'dead_letter'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'media_cleanup_queue_max_attempts_check'
      and conrelid = 'public.media_cleanup_queue'::regclass
  ) then
    alter table public.media_cleanup_queue
      add constraint media_cleanup_queue_max_attempts_check
      check (max_attempts between 1 and 1000);
  end if;
end
$$;

update public.media_cleanup_queue
set max_attempts = case
  when reason like 'feedback_delete:%' then 5
  else 40
end
where max_attempts is null
   or max_attempts < 1
   or max_attempts > 1000;

update public.media_cleanup_queue
set status = case
  when processed_at is null and coalesce(last_error, '') = '' then 'pending'
  when processed_at is null and coalesce(last_error, '') <> '' then 'retrying'
  when processed_at is not null and coalesce(last_error, '') = '' then 'succeeded'
  when processed_at is not null and coalesce(last_error, '') <> '' then 'dead_letter'
  else 'pending'
end
where status is null
   or status not in ('pending', 'processing', 'retrying', 'succeeded', 'failed', 'dead_letter');

update public.media_cleanup_queue
set succeeded_at = coalesce(succeeded_at, processed_at)
where processed_at is not null
  and status = 'succeeded';

update public.media_cleanup_queue
set dead_letter_at = coalesce(dead_letter_at, processed_at),
    failed_at = coalesce(failed_at, processed_at)
where processed_at is not null
  and status in ('failed', 'dead_letter');

create index if not exists idx_media_cleanup_queue_poll_v2
  on public.media_cleanup_queue (provider, status, not_before, id)
  where processed_at is null;

create index if not exists idx_media_cleanup_queue_lock_expires
  on public.media_cleanup_queue (lock_expires_at)
  where processed_at is null and lock_expires_at is not null;

create or replace function public.claim_media_cleanup_jobs(
  p_limit integer default 200,
  p_provider text default null,
  p_lock_ms integer default 600000,
  p_worker text default null
)
returns table (
  id bigint,
  provider text,
  object_key text,
  company_id uuid,
  entity_type text,
  entity_id uuid,
  order_id uuid,
  attempts integer,
  reason text,
  max_attempts integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_lock_ms integer := greatest(10000, least(coalesce(p_lock_ms, 600000), 86400000));
  v_worker text := coalesce(nullif(trim(p_worker), ''), 'media-cleanup');
begin
  return query
  with candidate as (
    select q.id
    from public.media_cleanup_queue q
    where q.processed_at is null
      and q.status in ('pending', 'retrying')
      and q.not_before <= now()
      and (q.lock_expires_at is null or q.lock_expires_at <= now())
      and (p_provider is null or q.provider = p_provider)
    order by q.id
    for update skip locked
    limit v_limit
  )
  update public.media_cleanup_queue q
  set status = 'processing',
      attempts = greatest(0, coalesce(q.attempts, 0)) + 1,
      first_attempt_at = coalesce(q.first_attempt_at, now()),
      last_attempt_at = now(),
      locked_at = now(),
      lock_expires_at = now() + (v_lock_ms::text || ' milliseconds')::interval,
      claimed_by = v_worker,
      updated_at = now()
  from candidate c
  where q.id = c.id
  returning
    q.id,
    q.provider,
    q.object_key,
    q.company_id,
    q.entity_type,
    q.entity_id,
    q.order_id,
    q.attempts,
    q.reason,
    q.max_attempts,
    q.status;
end;
$$;

create or replace function public.finalize_media_cleanup_job(
  p_id bigint,
  p_success boolean,
  p_error_message text default null,
  p_error_code text default null,
  p_retry_delay_ms integer default 300000,
  p_force_dead_letter boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_retry_ms integer := greatest(1000, least(coalesce(p_retry_delay_ms, 300000), 86400000));
  v_row public.media_cleanup_queue%rowtype;
begin
  select *
    into v_row
    from public.media_cleanup_queue
   where id = p_id
   for update;

  if not found then
    return 'missing';
  end if;

  if p_success then
    update public.media_cleanup_queue
       set status = 'succeeded',
           processed_at = now(),
           succeeded_at = now(),
           failed_at = null,
           dead_letter_at = null,
           last_error = null,
           error_code = null,
           locked_at = null,
           lock_expires_at = null,
           claimed_by = null,
           updated_at = now()
     where id = p_id;
    return 'succeeded';
  end if;

  if p_force_dead_letter or coalesce(v_row.attempts, 0) >= coalesce(v_row.max_attempts, 40) then
    update public.media_cleanup_queue
       set status = 'dead_letter',
           processed_at = now(),
           failed_at = now(),
           dead_letter_at = now(),
           last_error = coalesce(nullif(trim(p_error_message), ''), 'media_cleanup_failed'),
           error_code = nullif(trim(p_error_code), ''),
           locked_at = null,
           lock_expires_at = null,
           claimed_by = null,
           updated_at = now()
     where id = p_id;
    return 'dead_letter';
  end if;

  update public.media_cleanup_queue
     set status = 'retrying',
         failed_at = now(),
         last_error = coalesce(nullif(trim(p_error_message), ''), 'media_cleanup_failed'),
         error_code = nullif(trim(p_error_code), ''),
         not_before = now() + (v_retry_ms::text || ' milliseconds')::interval,
         locked_at = null,
         lock_expires_at = null,
         claimed_by = null,
         updated_at = now()
   where id = p_id;
  return 'retrying';
end;
$$;

grant execute on function public.claim_media_cleanup_jobs(integer, text, integer, text) to service_role;
grant execute on function public.finalize_media_cleanup_job(bigint, boolean, text, text, integer, boolean) to service_role;

create or replace function public.enqueue_media_cleanup_from_profile_map_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(old.provider), '') in ('beget_s3', 'yandex_disk')
     and coalesce(trim(old.external_path), '') <> '' then
    insert into public.media_cleanup_queue (
      provider,
      object_key,
      company_id,
      entity_type,
      entity_id,
      reason,
      not_before,
      status,
      max_attempts
    )
    values (
      old.provider,
      old.external_path,
      old.company_id,
      old.entity_type,
      old.entity_id,
      'profile_map_delete',
      now(),
      'pending',
      40
    )
    on conflict (provider, object_key) do update
      set company_id = excluded.company_id,
          entity_type = excluded.entity_type,
          entity_id = excluded.entity_id,
          reason = excluded.reason,
          processed_at = null,
          succeeded_at = null,
          failed_at = null,
          dead_letter_at = null,
          status = 'pending',
          locked_at = null,
          lock_expires_at = null,
          claimed_by = null,
          error_code = null,
          last_error = null,
          not_before = now(),
          max_attempts = greatest(1, coalesce(public.media_cleanup_queue.max_attempts, 40)),
          updated_at = now();
  end if;

  return old;
end
$$;

create or replace function public.enqueue_media_cleanup_from_order_map_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(old.provider), '') in ('beget_s3', 'yandex_disk')
     and coalesce(trim(old.external_path), '') <> '' then
    insert into public.media_cleanup_queue (
      provider,
      object_key,
      company_id,
      order_id,
      reason,
      not_before,
      status,
      max_attempts
    )
    values (
      old.provider,
      old.external_path,
      old.company_id,
      old.order_id,
      'order_map_delete',
      now(),
      'pending',
      40
    )
    on conflict (provider, object_key) do update
      set company_id = excluded.company_id,
          order_id = excluded.order_id,
          reason = excluded.reason,
          processed_at = null,
          succeeded_at = null,
          failed_at = null,
          dead_letter_at = null,
          status = 'pending',
          locked_at = null,
          lock_expires_at = null,
          claimed_by = null,
          error_code = null,
          last_error = null,
          not_before = now(),
          max_attempts = 40,
          updated_at = now();
  end if;

  return old;
end
$$;

commit;

