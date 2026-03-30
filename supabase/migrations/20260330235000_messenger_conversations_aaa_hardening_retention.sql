begin;

-- 1) Normalize legacy inconsistencies before adding stronger constraints.
update public.messenger_conversations
set state = '{}'::jsonb
where state is null
   or jsonb_typeof(state) is distinct from 'object';

update public.messenger_conversations
set started_at = coalesce(started_at, created_at, now())
where status in ('collecting', 'confirming', 'completed')
  and started_at is null;

update public.messenger_conversations
set completed_at = null
where status <> 'completed'
  and completed_at is not null;

update public.messenger_conversations
set completed_at = coalesce(completed_at, updated_at, now())
where status = 'completed'
  and completed_at is null;

-- 2) Strong consistency checks.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messenger_conversations_state_object_check'
      and conrelid = 'public.messenger_conversations'::regclass
  ) then
    alter table public.messenger_conversations
      add constraint messenger_conversations_state_object_check
      check (jsonb_typeof(state) = 'object');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messenger_conversations_status_started_at_check'
      and conrelid = 'public.messenger_conversations'::regclass
  ) then
    alter table public.messenger_conversations
      add constraint messenger_conversations_status_started_at_check
      check (
        (status in ('collecting', 'confirming', 'completed') and started_at is not null)
        or status in ('idle', 'blocked')
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messenger_conversations_status_completed_at_check'
      and conrelid = 'public.messenger_conversations'::regclass
  ) then
    alter table public.messenger_conversations
      add constraint messenger_conversations_status_completed_at_check
      check (
        (status = 'completed' and completed_at is not null)
        or (status <> 'completed' and completed_at is null)
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messenger_conversations_completed_after_started_check'
      and conrelid = 'public.messenger_conversations'::regclass
  ) then
    alter table public.messenger_conversations
      add constraint messenger_conversations_completed_after_started_check
      check (
        completed_at is null
        or started_at is null
        or completed_at >= started_at
      );
  end if;
end
$$;

-- 3) Guard trigger: keep row consistent on every write.
create or replace function public.messenger_conversations_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.state is null or jsonb_typeof(new.state) is distinct from 'object' then
    new.state := '{}'::jsonb;
  end if;

  if new.status in ('collecting', 'confirming') then
    new.started_at := coalesce(new.started_at, now());
    new.completed_at := null;
  elsif new.status = 'completed' then
    new.started_at := coalesce(new.started_at, new.created_at, now());
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;

  return new;
end
$$;

drop trigger if exists trg_messenger_conversations_guard on public.messenger_conversations;
create trigger trg_messenger_conversations_guard
before insert or update on public.messenger_conversations
for each row execute function public.messenger_conversations_guard();

-- 4) Performance indexes for hot paths + retention scans.
create index if not exists messenger_conversations_provider_status_last_message_idx
  on public.messenger_conversations(provider, status, last_message_at desc, updated_at desc);

create index if not exists messenger_conversations_integration_status_updated_idx
  on public.messenger_conversations(integration_id, status, updated_at desc)
  where integration_id is not null;

create index if not exists messenger_conversations_retention_scan_idx
  on public.messenger_conversations(
    status,
    coalesce(last_message_at, completed_at, updated_at, created_at)
  );

-- 5) Archive table for long-term lifecycle (avoid endless growth in primary table).
create table if not exists public.messenger_conversations_archive (
  id bigserial primary key,
  source_conversation_id uuid not null unique,
  provider text not null,
  external_chat_id text not null,
  company_id uuid,
  integration_id uuid,
  status text not null,
  started_at timestamptz,
  completed_at timestamptz,
  last_message_at timestamptz,
  archived_at timestamptz not null default now(),
  archive_reason text not null default 'retention',
  payload jsonb not null
);

create index if not exists messenger_conversations_archive_archived_at_idx
  on public.messenger_conversations_archive(archived_at);

create index if not exists messenger_conversations_archive_provider_status_idx
  on public.messenger_conversations_archive(provider, status, archived_at desc);

alter table public.messenger_conversations_archive enable row level security;
revoke all on public.messenger_conversations_archive from anon, authenticated;
grant select, insert, delete on table public.messenger_conversations_archive to service_role;
grant usage, select on sequence public.messenger_conversations_archive_id_seq to service_role;

-- 6) Retention functions: archive stale rows from primary, then purge very old archive rows.
create or replace function public.archive_stale_messenger_conversations(
  p_stale_days integer default 730,
  p_batch_limit integer default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stale_days integer := greatest(30, least(coalesce(p_stale_days, 730), 36500));
  v_limit integer := greatest(1, least(coalesce(p_batch_limit, 5000), 100000));
  v_ids uuid[];
  v_archived integer := 0;
  v_deleted integer := 0;
begin
  select array_agg(d.id)
    into v_ids
  from (
    select m.id
    from public.messenger_conversations m
    where m.status in ('idle', 'completed', 'blocked')
      and coalesce(m.last_message_at, m.completed_at, m.updated_at, m.created_at)
          < now() - make_interval(days => v_stale_days)
    order by coalesce(m.last_message_at, m.completed_at, m.updated_at, m.created_at) asc
    limit v_limit
    for update skip locked
  ) d;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'archived', 0,
      'deleted_from_primary', 0,
      'stale_days', v_stale_days
    );
  end if;

  insert into public.messenger_conversations_archive (
    source_conversation_id,
    provider,
    external_chat_id,
    company_id,
    integration_id,
    status,
    started_at,
    completed_at,
    last_message_at,
    archive_reason,
    payload
  )
  select
    m.id,
    m.provider,
    m.external_chat_id,
    m.company_id,
    m.integration_id,
    m.status,
    m.started_at,
    m.completed_at,
    m.last_message_at,
    'retention',
    to_jsonb(m.*)
  from public.messenger_conversations m
  where m.id = any(v_ids)
  on conflict (source_conversation_id) do nothing;
  get diagnostics v_archived = row_count;

  delete from public.messenger_conversations
  where id = any(v_ids);
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'archived', coalesce(v_archived, 0),
    'deleted_from_primary', coalesce(v_deleted, 0),
    'stale_days', v_stale_days
  );
end;
$$;

create or replace function public.purge_messenger_conversations_archive(
  p_keep_days integer default 3650,
  p_batch_limit integer default 100000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keep_days integer := greatest(365, least(coalesce(p_keep_days, 3650), 36500));
  v_limit integer := greatest(1, least(coalesce(p_batch_limit, 100000), 1000000));
  v_deleted integer := 0;
begin
  with doomed as (
    select ctid
    from public.messenger_conversations_archive
    where archived_at < now() - make_interval(days => v_keep_days)
    order by archived_at asc
    limit v_limit
  )
  delete from public.messenger_conversations_archive a
  using doomed d
  where a.ctid = d.ctid;

  get diagnostics v_deleted = row_count;
  return jsonb_build_object(
    'deleted_from_archive', coalesce(v_deleted, 0),
    'keep_days', v_keep_days
  );
end;
$$;

grant execute on function public.archive_stale_messenger_conversations(integer, integer) to service_role;
grant execute on function public.purge_messenger_conversations_archive(integer, integer) to service_role;

-- 7) Scheduler (if pg_cron installed): archive stale primary rows daily; purge old archive weekly.
do $$
declare
  v_exists boolean;
begin
  select exists(select 1 from pg_extension where extname = 'pg_cron') into v_exists;
  if v_exists then
    begin
      perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'messenger_conversations_archive_daily';
    exception when others then
      null;
    end;

    begin
      perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'messenger_conversations_archive_purge_weekly';
    exception when others then
      null;
    end;

    perform cron.schedule(
      'messenger_conversations_archive_daily',
      '11 4 * * *',
      'select public.archive_stale_messenger_conversations(730, 5000);'
    );

    perform cron.schedule(
      'messenger_conversations_archive_purge_weekly',
      '29 4 * * 0',
      'select public.purge_messenger_conversations_archive(3650, 100000);'
    );
  end if;
end
$$;

commit;
