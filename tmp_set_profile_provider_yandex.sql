update public.companies
set profile_media_provider = 'yandex_disk'
where id = 'a8f52d3f-c189-4df2-9690-b34a26d2e114';

notify pgrst, 'reload schema';
