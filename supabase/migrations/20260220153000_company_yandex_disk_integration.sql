-- Company media provider + Yandex Disk integration

alter table public.companies
  add column if not exists media_provider text not null default 'app_storage';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'companies_media_provider_check'
      and conrelid = 'public.companies'::regclass
  ) then
    alter table public.companies
      add constraint companies_media_provider_check
      check (media_provider in ('app_storage', 'yandex_disk'));
  end if;
end
$$;

create table if not exists public.company_yandex_disk_connections (
  company_id uuid primary key references public.companies(id) on delete cascade,
  yandex_user_id text,
  yandex_login text,
  yandex_display_name text,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  folder_path text not null default '/apps/field-work',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.company_integration_oauth_states (
  state text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null,
  requested_by uuid not null references auth.users(id) on delete cascade,
  redirect_to text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_company_integration_oauth_states_company_provider
  on public.company_integration_oauth_states (company_id, provider);

create table if not exists public.order_media_external_map (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  category text not null,
  provider text not null,
  source_url text not null,
  external_path text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (order_id, category, source_url)
);

create index if not exists idx_order_media_external_map_order_category
  on public.order_media_external_map (order_id, category);

alter table public.company_yandex_disk_connections enable row level security;
alter table public.company_integration_oauth_states enable row level security;
alter table public.order_media_external_map enable row level security;

-- No direct client access. Data is managed by service-role edge functions only.
revoke all on public.company_yandex_disk_connections from anon, authenticated;
revoke all on public.company_integration_oauth_states from anon, authenticated;
revoke all on public.order_media_external_map from anon, authenticated;
