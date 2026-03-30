begin;

-- 1) Explicit service-role policy (defense in depth with enabled RLS).
drop policy if exists object_media_external_map_service_role_all on public.object_media_external_map;
create policy object_media_external_map_service_role_all
on public.object_media_external_map
for all
to service_role
using (true)
with check (true);

-- 2) Normalize values once.
update public.object_media_external_map
set
  source_url = btrim(source_url),
  external_path = btrim(external_path),
  display_url = nullif(btrim(display_url), '');

-- 3) Strong invariants.
alter table public.object_media_external_map
  drop constraint if exists object_media_external_map_source_url_nonblank_check,
  drop constraint if exists object_media_external_map_external_path_nonblank_check,
  drop constraint if exists object_media_external_map_source_url_https_check,
  drop constraint if exists object_media_external_map_display_url_https_check,
  drop constraint if exists object_media_external_map_file_size_nonnegative_check;

alter table public.object_media_external_map
  add constraint object_media_external_map_source_url_nonblank_check
    check (btrim(source_url) <> ''),
  add constraint object_media_external_map_external_path_nonblank_check
    check (btrim(external_path) <> ''),
  add constraint object_media_external_map_source_url_https_check
    check (source_url ~ '^https://[^[:space:]]+$'),
  add constraint object_media_external_map_display_url_https_check
    check (display_url is null or display_url ~ '^https://[^[:space:]]+$'),
  add constraint object_media_external_map_file_size_nonnegative_check
    check (file_size_bytes >= 0);

-- 4) Guard: object must belong to the same company.
create or replace function public.object_media_external_map_validate_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object_company_id uuid;
begin
  select o.company_id
    into v_object_company_id
  from public.client_objects o
  where o.id = new.object_id;

  if v_object_company_id is null then
    raise exception using
      errcode = '23503',
      message = 'object_id must reference an existing client_objects row';
  end if;

  if v_object_company_id <> new.company_id then
    raise exception using
      errcode = '23514',
      message = 'company_id must match object company_id in object_media_external_map';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_object_media_external_map_validate_refs on public.object_media_external_map;
create trigger trg_object_media_external_map_validate_refs
before insert or update of company_id, object_id
on public.object_media_external_map
for each row
execute function public.object_media_external_map_validate_refs();

commit;
