select p.company_id, c.profile_media_provider, (exists(select 1 from public.company_yandex_disk_connections y where y.company_id = p.company_id)) as yandex_connected
from public.profiles p
join public.companies c on c.id = p.company_id
where p.id = '8b29d952-70fa-476b-baa5-140e1ae669e9';
