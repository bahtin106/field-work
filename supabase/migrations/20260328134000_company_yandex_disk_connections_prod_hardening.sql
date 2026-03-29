begin;

-- 1) Normalize created_by relation for Studio navigation (arrow to profiles).
update public.company_yandex_disk_connections c
set created_by = null
where c.created_by is not null
  and not exists (select 1 from public.profiles p where p.id = c.created_by);

alter table public.company_yandex_disk_connections
  drop constraint if exists company_yandex_disk_connections_created_by_fkey;

alter table public.company_yandex_disk_connections
  add constraint company_yandex_disk_connections_created_by_fkey
  foreign key (created_by)
  references public.profiles(id)
  on delete set null
  not valid;

alter table public.company_yandex_disk_connections
  validate constraint company_yandex_disk_connections_created_by_fkey;

-- 2) Data integrity checks.
alter table public.company_yandex_disk_connections
  drop constraint if exists company_yandex_disk_connections_access_token_nonempty_check,
  drop constraint if exists company_yandex_disk_connections_refresh_token_nonempty_check,
  drop constraint if exists company_yandex_disk_connections_folder_path_nonempty_check,
  drop constraint if exists company_yandex_disk_connections_folder_path_format_check;

alter table public.company_yandex_disk_connections
  add constraint company_yandex_disk_connections_access_token_nonempty_check
    check (btrim(access_token) <> ''),
  add constraint company_yandex_disk_connections_refresh_token_nonempty_check
    check (btrim(refresh_token) <> ''),
  add constraint company_yandex_disk_connections_folder_path_nonempty_check
    check (btrim(folder_path) <> ''),
  add constraint company_yandex_disk_connections_folder_path_format_check
    check (left(folder_path, 1) = '/');

-- 3) Keep updated_at reliable on every update.
create or replace function public.company_yandex_disk_connections_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_company_yandex_disk_connections_touch_updated_at
  on public.company_yandex_disk_connections;

create trigger trg_company_yandex_disk_connections_touch_updated_at
before update on public.company_yandex_disk_connections
for each row execute function public.company_yandex_disk_connections_touch_updated_at();

commit;