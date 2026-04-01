begin;

-- 1) Keep table private to backend role.
revoke all on table public.profile_media_external_map from anon;
revoke all on table public.profile_media_external_map from authenticated;
revoke all on table public.profile_media_external_map from service_role;
grant select, insert, update, delete on table public.profile_media_external_map to service_role;
grant usage, select on sequence public.profile_media_external_map_id_seq to service_role;

-- 2) Explicit service policy (defense in depth with enabled RLS).
drop policy if exists profile_media_external_map_service_role_all on public.profile_media_external_map;
create policy profile_media_external_map_service_role_all
on public.profile_media_external_map
for all
to service_role
using (true)
with check (true);

-- 3) Normalize existing values.
update public.profile_media_external_map
set
  provider = lower(btrim(provider)),
  db_url = btrim(db_url),
  external_path = btrim(external_path),
  updated_at = now()
where true;

-- 4) Strong invariants.
alter table public.profile_media_external_map
  drop constraint if exists profile_media_external_map_entity_type_check,
  drop constraint if exists profile_media_external_map_provider_check,
  drop constraint if exists profile_media_external_map_db_url_nonblank_check,
  drop constraint if exists profile_media_external_map_external_path_nonblank_check,
  drop constraint if exists profile_media_external_map_db_url_shape_check,
  drop constraint if exists profile_media_external_map_file_size_nonnegative_check;

alter table public.profile_media_external_map
  add constraint profile_media_external_map_entity_type_check
    check (entity_type in ('employee', 'client', 'object', 'feedback', 'feedback_attachment')),
  add constraint profile_media_external_map_provider_check
    check (provider in ('beget_s3', 'yandex_disk')),
  add constraint profile_media_external_map_db_url_nonblank_check
    check (btrim(db_url) <> ''),
  add constraint profile_media_external_map_external_path_nonblank_check
    check (btrim(external_path) <> ''),
  add constraint profile_media_external_map_db_url_shape_check
    check (
      (provider = 'beget_s3' and db_url ~ '^https://[^[:space:]]+$')
      or
      (provider = 'yandex_disk' and db_url ~ '^(https://|yadisk://)[^[:space:]]+$')
    ),
  add constraint profile_media_external_map_file_size_nonnegative_check
    check (file_size_bytes >= 0);

create index if not exists idx_profile_media_external_map_company_created
  on public.profile_media_external_map (company_id, created_at desc);

-- 5) Company-boundary guard for polymorphic entities.
create or replace function public.profile_media_external_map_validate_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity_company_id uuid;
begin
  if new.entity_type = 'employee' then
    select p.company_id into v_entity_company_id
    from public.profiles p
    where p.id = new.entity_id;

  elsif new.entity_type = 'client' then
    select c.company_id into v_entity_company_id
    from public.clients c
    where c.id = new.entity_id;

  elsif new.entity_type = 'object' then
    select o.company_id into v_entity_company_id
    from public.client_objects o
    where o.id = new.entity_id;

  elsif new.entity_type = 'feedback' then
    select f.company_id into v_entity_company_id
    from public.feedbacks f
    where f.id = new.entity_id;

  elsif new.entity_type = 'feedback_attachment' then
    select f.company_id into v_entity_company_id
    from public.feedback_attachments fa
    join public.feedbacks f on f.id = fa.feedback_id
    where fa.id = new.entity_id;

  else
    raise exception using
      errcode = '23514',
      message = 'unsupported entity_type in profile_media_external_map';
  end if;

  if v_entity_company_id is null then
    raise exception using
      errcode = '23503',
      message = 'entity_id does not exist for given entity_type in profile_media_external_map';
  end if;

  if v_entity_company_id <> new.company_id then
    raise exception using
      errcode = '23514',
      message = 'company_id must match entity company_id in profile_media_external_map';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profile_media_external_map_validate_refs on public.profile_media_external_map;
create trigger trg_profile_media_external_map_validate_refs
before insert or update of company_id, entity_type, entity_id
on public.profile_media_external_map
for each row
execute function public.profile_media_external_map_validate_refs();

-- 6) Keep updated_at consistent.
drop trigger if exists trg_profile_media_external_map_set_updated_at on public.profile_media_external_map;
create trigger trg_profile_media_external_map_set_updated_at
before update on public.profile_media_external_map
for each row
execute function public.set_updated_at();

commit;
