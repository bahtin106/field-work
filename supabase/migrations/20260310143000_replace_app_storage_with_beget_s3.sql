alter table public.companies
  alter column media_provider set default 'beget_s3';

alter table public.companies
  alter column profile_media_provider set default 'beget_s3';

alter table public.companies
  drop constraint if exists companies_media_provider_check;

alter table public.companies
  add constraint companies_media_provider_check
  check (media_provider in ('beget_s3', 'yandex_disk'));

alter table public.companies
  drop constraint if exists companies_profile_media_provider_check;

alter table public.companies
  add constraint companies_profile_media_provider_check
  check (profile_media_provider in ('beget_s3', 'yandex_disk'));

update public.companies
set media_provider = 'beget_s3'
where coalesce(media_provider, '') = '' or media_provider = 'app_storage';

update public.companies
set profile_media_provider = 'beget_s3'
where coalesce(profile_media_provider, '') = '' or profile_media_provider = 'app_storage';
