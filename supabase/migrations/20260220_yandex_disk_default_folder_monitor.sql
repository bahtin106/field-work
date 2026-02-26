-- Normalize Yandex Disk default folder to "/Монитор"

begin;

alter table public.company_yandex_disk_connections
  alter column folder_path set default '/Монитор';

update public.company_yandex_disk_connections
set folder_path = '/Монитор'
where coalesce(trim(folder_path), '') in ('', '/apps/field-work', 'apps/field-work');

commit;
