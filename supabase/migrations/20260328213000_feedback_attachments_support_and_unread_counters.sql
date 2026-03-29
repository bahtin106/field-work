-- Support requests: multi-photo attachments (up to 5), production-safe.

create table if not exists public.feedback_attachments (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedbacks(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid null references public.profiles(id) on delete set null,
  photo_url text null,
  sort_order int4 not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_attachments_feedback_sort
  on public.feedback_attachments (feedback_id, sort_order, created_at);

create index if not exists idx_feedback_attachments_company_created
  on public.feedback_attachments (company_id, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feedback_attachments_sort_non_negative_chk'
      and conrelid = 'public.feedback_attachments'::regclass
  ) then
    alter table public.feedback_attachments
      add constraint feedback_attachments_sort_non_negative_chk
      check (sort_order >= 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feedback_attachments_photo_len_chk'
      and conrelid = 'public.feedback_attachments'::regclass
  ) then
    alter table public.feedback_attachments
      add constraint feedback_attachments_photo_len_chk
      check (photo_url is null or length(photo_url) <= 4000);
  end if;
end
$$;

-- Backfill legacy single-photo support requests into attachments.
insert into public.feedback_attachments (feedback_id, company_id, created_by, photo_url, sort_order, created_at)
select f.id, f.company_id, f.user_id, f.photo_url, 0, coalesce(f.created_at, now())
from public.feedbacks f
where nullif(trim(coalesce(f.photo_url, '')), '') is not null
  and not exists (
    select 1
    from public.feedback_attachments a
    where a.feedback_id = f.id
      and a.photo_url = f.photo_url
  );

-- Keep legacy photo_url synced to the first attachment for backward compatibility.
create or replace function public.sync_feedback_legacy_photo_url()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_feedback_id uuid;
  v_first_url text;
begin
  v_feedback_id := coalesce(new.feedback_id, old.feedback_id);
  if v_feedback_id is null then
    return coalesce(new, old);
  end if;

  select a.photo_url
    into v_first_url
  from public.feedback_attachments a
  where a.feedback_id = v_feedback_id
    and nullif(trim(coalesce(a.photo_url, '')), '') is not null
  order by a.sort_order asc, a.created_at asc, a.id asc
  limit 1;

  update public.feedbacks f
  set photo_url = nullif(trim(coalesce(v_first_url, '')), '')
  where f.id = v_feedback_id;

  return coalesce(new, old);
end
$$;

drop trigger if exists trg_feedback_attachments_sync_legacy on public.feedback_attachments;
create trigger trg_feedback_attachments_sync_legacy
after insert or update or delete on public.feedback_attachments
for each row
execute function public.sync_feedback_legacy_photo_url();

-- Strengthen check on parent table: max 5 attachments per request.
create or replace function public.enforce_feedback_attachments_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_feedback_id uuid;
  v_count int;
begin
  v_feedback_id := coalesce(new.feedback_id, old.feedback_id);
  if v_feedback_id is null then
    return coalesce(new, old);
  end if;

  select count(*)::int into v_count
  from public.feedback_attachments a
  where a.feedback_id = v_feedback_id;

  if v_count > 5 then
    raise exception 'feedback supports at most 5 photos';
  end if;

  return coalesce(new, old);
end
$$;

drop trigger if exists trg_feedback_attachments_limit on public.feedback_attachments;
create trigger trg_feedback_attachments_limit
after insert or update on public.feedback_attachments
for each row
execute function public.enforce_feedback_attachments_limit();

alter table public.feedback_attachments enable row level security;

drop policy if exists feedback_attachments_select_own_or_super on public.feedback_attachments;
drop policy if exists feedback_attachments_insert_own on public.feedback_attachments;
drop policy if exists feedback_attachments_update_super_only on public.feedback_attachments;
drop policy if exists feedback_attachments_delete_super_only on public.feedback_attachments;

create policy feedback_attachments_select_own_or_super
on public.feedback_attachments
for select
to authenticated
using (
  public.is_super_admin()
  or exists (
    select 1
    from public.feedbacks f
    where f.id = feedback_id
      and f.user_id = auth.uid()
  )
);

create policy feedback_attachments_insert_own
on public.feedback_attachments
for insert
to authenticated
with check (
  coalesce(created_by, auth.uid()) = auth.uid()
  and exists (
    select 1
    from public.feedbacks f
    where f.id = feedback_id
      and f.user_id = auth.uid()
      and f.company_id = company_id
  )
);

create policy feedback_attachments_update_super_only
on public.feedback_attachments
for update
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy feedback_attachments_delete_super_only
on public.feedback_attachments
for delete
to authenticated
using (public.is_super_admin());

-- Expand profile-media mapping support to attachments.
do $$
begin
  begin
    alter table if exists public.profile_media_external_map
      drop constraint if exists profile_media_external_map_entity_type_check;

    alter table if exists public.profile_media_external_map
      add constraint profile_media_external_map_entity_type_check
      check (entity_type in ('employee', 'client', 'object', 'feedback', 'feedback_attachment'));
  exception
    when insufficient_privilege then
      raise notice 'skip profile_media_external_map constraint update: insufficient privilege';
  end;
end
$$;

create or replace function public.delete_profile_media_map_for_feedback_attachment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.profile_media_external_map
  where entity_type = 'feedback_attachment'
    and entity_id = old.id;
  return old;
end
$$;

drop trigger if exists trg_feedback_attachments_delete_profile_media_map on public.feedback_attachments;
create trigger trg_feedback_attachments_delete_profile_media_map
after delete on public.feedback_attachments
for each row
execute function public.delete_profile_media_map_for_feedback_attachment();
