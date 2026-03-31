begin;

-- Keep table private to backend only.
revoke all on table public.order_media_external_map from anon;
revoke all on table public.order_media_external_map from authenticated;
revoke all on table public.order_media_external_map from service_role;
grant select, insert, update, delete on table public.order_media_external_map to service_role;

-- Service policy for explicitness (service_role bypasses RLS, but keep policy for consistency).
drop policy if exists order_media_external_map_service_role_all on public.order_media_external_map;
create policy order_media_external_map_service_role_all
on public.order_media_external_map
for all
to service_role
using (true)
with check (true);

-- Normalize whitespace in-place.
update public.order_media_external_map
set
  source_url = btrim(source_url),
  external_path = btrim(external_path),
  display_url = nullif(btrim(coalesce(display_url, '')), '')
where true;

alter table public.order_media_external_map
  drop constraint if exists order_media_external_map_provider_check,
  drop constraint if exists order_media_external_map_source_url_nonblank_check,
  drop constraint if exists order_media_external_map_external_path_nonblank_check,
  drop constraint if exists order_media_external_map_source_url_shape_check,
  drop constraint if exists order_media_external_map_display_url_https_check,
  drop constraint if exists order_media_external_map_file_size_nonnegative_check;

alter table public.order_media_external_map
  add constraint order_media_external_map_provider_check
    check (provider in ('beget_s3', 'yandex_disk')),
  add constraint order_media_external_map_source_url_nonblank_check
    check (btrim(source_url) <> ''),
  add constraint order_media_external_map_external_path_nonblank_check
    check (btrim(external_path) <> ''),
  add constraint order_media_external_map_source_url_shape_check
    check (
      (provider = 'beget_s3' and source_url ~ '^https://[^[:space:]]+$')
      or
      (provider = 'yandex_disk' and source_url ~ '^(https://|yadisk://)[^[:space:]]+$')
    ),
  add constraint order_media_external_map_display_url_https_check
    check (display_url is null or display_url ~ '^https://[^[:space:]]+$'),
  add constraint order_media_external_map_file_size_nonnegative_check
    check (file_size_bytes >= 0);

create index if not exists idx_order_media_external_map_company_created
  on public.order_media_external_map (company_id, created_at desc);

create or replace function public.order_media_external_map_validate_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_company_id uuid;
begin
  select o.company_id
    into v_order_company_id
    from public.orders o
   where o.id = new.order_id;

  if v_order_company_id is null then
    raise exception using
      errcode = '23503',
      message = 'order_id does not exist in order_media_external_map';
  end if;

  if v_order_company_id <> new.company_id then
    raise exception using
      errcode = '23514',
      message = 'company_id must match order company_id in order_media_external_map';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_media_external_map_validate_refs on public.order_media_external_map;
create trigger trg_order_media_external_map_validate_refs
before insert or update of company_id, order_id
on public.order_media_external_map
for each row
execute function public.order_media_external_map_validate_refs();

commit;