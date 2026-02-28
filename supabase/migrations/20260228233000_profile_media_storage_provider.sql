alter table public.companies
  add column if not exists profile_media_provider text not null default 'app_storage';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'companies_profile_media_provider_check'
      and conrelid = 'public.companies'::regclass
  ) then
    alter table public.companies
      add constraint companies_profile_media_provider_check
      check (profile_media_provider in ('app_storage', 'yandex_disk'));
  end if;
end
$$;

create table if not exists public.profile_media_external_map (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  provider text not null,
  db_url text not null,
  external_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (entity_type, entity_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profile_media_external_map_entity_type_check'
      and conrelid = 'public.profile_media_external_map'::regclass
  ) then
    alter table public.profile_media_external_map
      add constraint profile_media_external_map_entity_type_check
      check (entity_type in ('employee', 'client', 'object'));
  end if;
end
$$;

create index if not exists idx_profile_media_external_map_company_db_url
  on public.profile_media_external_map (company_id, db_url);

create index if not exists idx_profile_media_external_map_entity
  on public.profile_media_external_map (entity_type, entity_id);

alter table public.profile_media_external_map enable row level security;

revoke all on public.profile_media_external_map from anon, authenticated;
