-- Support requests hardening + media integration

alter table if exists public.feedbacks
  add column if not exists company_id uuid,
  add column if not exists full_name text,
  add column if not exists photo_url text,
  add column if not exists is_read boolean,
  add column if not exists read_at timestamptz,
  add column if not exists read_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feedbacks_company_id_fkey'
      and conrelid = 'public.feedbacks'::regclass
  ) then
    alter table public.feedbacks
      add constraint feedbacks_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete cascade;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feedbacks_user_id_fkey'
      and conrelid = 'public.feedbacks'::regclass
  ) then
    alter table public.feedbacks
      add constraint feedbacks_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete set null;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feedbacks_read_by_fkey'
      and conrelid = 'public.feedbacks'::regclass
  ) then
    alter table public.feedbacks
      add constraint feedbacks_read_by_fkey
      foreign key (read_by) references public.profiles(id) on delete set null;
  end if;
end
$$;

update public.feedbacks f
set company_id = p.company_id
from public.profiles p
where f.company_id is null
  and f.user_id is not null
  and p.id = f.user_id;

update public.feedbacks f
set full_name = nullif(trim(concat_ws(' ', p.first_name, p.middle_name, p.last_name)), '')
from public.profiles p
where f.full_name is null
  and f.user_id is not null
  and p.id = f.user_id;

alter table public.feedbacks
  alter column created_at set default now(),
  alter column is_read set default false;

update public.feedbacks
set is_read = false
where is_read is null;

alter table public.feedbacks
  alter column is_read set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feedbacks_text_non_empty_chk'
      and conrelid = 'public.feedbacks'::regclass
  ) then
    alter table public.feedbacks
      add constraint feedbacks_text_non_empty_chk
      check (length(btrim(text)) > 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feedbacks_text_len_chk'
      and conrelid = 'public.feedbacks'::regclass
  ) then
    alter table public.feedbacks
      add constraint feedbacks_text_len_chk
      check (length(text) <= 2000);
  end if;
end
$$;

create or replace function public.tg_feedbacks_normalize_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();

  if new.user_id is null then
    new.user_id := v_uid;
  end if;

  if new.company_id is null and new.user_id is not null then
    select p.company_id into new.company_id
    from public.profiles p
    where p.id = new.user_id
    limit 1;
  end if;

  if (new.full_name is null or btrim(new.full_name) = '') and new.user_id is not null then
    select nullif(trim(concat_ws(' ', p.first_name, p.middle_name, p.last_name)), '')
      into new.full_name
    from public.profiles p
    where p.id = new.user_id
    limit 1;
  else
    new.full_name := nullif(btrim(new.full_name), '');
  end if;

  if new.created_at is null then
    new.created_at := now();
  end if;

  new.text := btrim(coalesce(new.text, ''));

  if new.text = '' then
    raise exception 'feedback text is required';
  end if;

  if new.is_read is null then
    new.is_read := false;
  end if;

  if new.is_read then
    if new.read_at is null then
      new.read_at := now();
    end if;
  else
    new.read_at := null;
    new.read_by := null;
  end if;

  return new;
end
$$;

drop trigger if exists trg_feedbacks_normalize_defaults on public.feedbacks;
create trigger trg_feedbacks_normalize_defaults
before insert or update on public.feedbacks
for each row
execute function public.tg_feedbacks_normalize_defaults();

create index if not exists idx_feedbacks_created_at_desc
  on public.feedbacks (created_at desc);

create index if not exists idx_feedbacks_company_created_at_desc
  on public.feedbacks (company_id, created_at desc);

create index if not exists idx_feedbacks_is_read_created_at_desc
  on public.feedbacks (is_read, created_at desc);

create index if not exists idx_feedbacks_user_created_at_desc
  on public.feedbacks (user_id, created_at desc);

alter table public.feedbacks enable row level security;

drop policy if exists "Users manage own feedbacks" on public.feedbacks;
drop policy if exists "allow insert feedbacks for authenticated" on public.feedbacks;
drop policy if exists "feedbacks_select_own" on public.feedbacks;
drop policy if exists feedbacks_select_own_or_super on public.feedbacks;
drop policy if exists feedbacks_insert_own on public.feedbacks;
drop policy if exists feedbacks_update_super_only on public.feedbacks;
drop policy if exists feedbacks_delete_super_only on public.feedbacks;

create policy feedbacks_select_own_or_super
on public.feedbacks
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_super_admin()
);

create policy feedbacks_insert_own
on public.feedbacks
for insert
to authenticated
with check (
  coalesce(user_id, auth.uid()) = auth.uid()
  and (
    company_id is null
    or company_id = (
      select p.company_id
      from public.profiles p
      where p.id = auth.uid()
      limit 1
    )
  )
);

create policy feedbacks_update_super_only
on public.feedbacks
for update
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy feedbacks_delete_super_only
on public.feedbacks
for delete
to authenticated
using (public.is_super_admin());

alter table if exists public.profile_media_external_map
  drop constraint if exists profile_media_external_map_entity_type_check;

alter table if exists public.profile_media_external_map
  add constraint profile_media_external_map_entity_type_check
  check (entity_type in ('employee', 'client', 'object', 'feedback'));

create or replace function public.delete_profile_media_map_for_entity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'profiles' then
    delete from public.profile_media_external_map
    where entity_type = 'employee'
      and entity_id = old.id;
  elsif tg_table_name = 'clients' then
    delete from public.profile_media_external_map
    where entity_type = 'client'
      and entity_id = old.id;
  elsif tg_table_name = 'client_objects' then
    delete from public.profile_media_external_map
    where entity_type = 'object'
      and entity_id = old.id;
  elsif tg_table_name = 'feedbacks' then
    delete from public.profile_media_external_map
    where entity_type = 'feedback'
      and entity_id = old.id;
  end if;

  return old;
end
$$;

drop trigger if exists trg_feedbacks_delete_profile_media_map on public.feedbacks;
create trigger trg_feedbacks_delete_profile_media_map
after delete on public.feedbacks
for each row
execute function public.delete_profile_media_map_for_entity();
