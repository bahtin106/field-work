begin;

create extension if not exists pgcrypto;

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create table if not exists public.messenger_integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null check (provider in ('telegram')),
  is_enabled boolean not null default false,
  onboarding_token text not null default encode(gen_random_bytes(12), 'hex'),
  destination_type text not null default 'feed' check (destination_type in ('feed', 'assignee')),
  destination_user_id uuid null references public.profiles(id) on delete set null,
  use_manual_required_fields boolean not null default true,
  create_client boolean not null default true,
  existing_client_policy text not null default 'reuse' check (existing_client_policy in ('reuse', 'order_only')),
  create_object boolean not null default true,
  existing_object_policy text not null default 'reuse_or_create' check (existing_object_policy in ('reuse_or_create', 'always_create')),
  welcome_message text null,
  success_message text null,
  failure_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider),
  unique (onboarding_token)
);

create index if not exists messenger_integrations_provider_enabled_idx
  on public.messenger_integrations(provider, is_enabled);

drop trigger if exists trg_messenger_integrations_updated_at on public.messenger_integrations;
create trigger trg_messenger_integrations_updated_at
before update on public.messenger_integrations
for each row execute function public.set_row_updated_at();

create table if not exists public.messenger_field_catalog (
  provider text not null check (provider in ('telegram')),
  field_key text not null,
  entity_scope text not null check (entity_scope in ('order', 'client', 'object')),
  input_kind text not null,
  label text not null,
  prompt text not null,
  placeholder text null,
  default_sort_order integer not null,
  default_enabled boolean not null default true,
  supports_required boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, field_key)
);

drop trigger if exists trg_messenger_field_catalog_updated_at on public.messenger_field_catalog;
create trigger trg_messenger_field_catalog_updated_at
before update on public.messenger_field_catalog
for each row execute function public.set_row_updated_at();

insert into public.messenger_field_catalog (
  provider,
  field_key,
  entity_scope,
  input_kind,
  label,
  prompt,
  placeholder,
  default_sort_order,
  default_enabled,
  supports_required,
  is_active
)
values
  ('telegram', 'title', 'order', 'text', 'Название заявки', 'Как назвать заявку?', 'Например: Протекает кран', 10, true, true, true),
  ('telegram', 'customer_name', 'client', 'text', 'Имя клиента', 'Как к вам обращаться?', 'Имя клиента', 20, true, true, true),
  ('telegram', 'phone', 'client', 'phone', 'Телефон', 'Укажите телефон для связи.', '+7 (999) 123-45-67', 30, true, true, true),
  ('telegram', 'comment', 'order', 'multiline', 'Комментарий', 'Опишите задачу или детали.', 'Коротко опишите проблему', 40, true, false, true),
  ('telegram', 'object_name', 'object', 'text', 'Название объекта', 'Как назвать объект?', 'Например: Квартира на Ленина', 50, true, false, true),
  ('telegram', 'city', 'object', 'text', 'Город', 'Введите город.', 'Город', 60, true, true, true),
  ('telegram', 'street', 'object', 'text', 'Улица', 'Введите улицу.', 'Улица', 70, true, true, true),
  ('telegram', 'house', 'object', 'text', 'Дом', 'Введите дом.', 'Дом', 80, true, true, true),
  ('telegram', 'apartment', 'object', 'text', 'Квартира', 'Введите квартиру, если есть.', 'Квартира', 90, false, false, true),
  ('telegram', 'office', 'object', 'text', 'Офис', 'Введите офис, если есть.', 'Офис', 100, false, false, true),
  ('telegram', 'entrance', 'object', 'text', 'Подъезд', 'Введите подъезд, если нужен.', 'Подъезд', 110, false, false, true),
  ('telegram', 'floor', 'object', 'text', 'Этаж', 'Введите этаж, если нужен.', 'Этаж', 120, false, false, true),
  ('telegram', 'entrance_info', 'object', 'multiline', 'Как попасть', 'Опишите, как попасть на объект.', 'Домофон, код, ориентиры', 130, false, false, true),
  ('telegram', 'parking_notes', 'object', 'multiline', 'Парковка', 'Нужны ли комментарии по парковке?', 'Где парковаться, шлагбаум и т.п.', 140, false, false, true)
on conflict (provider, field_key) do update
set
  entity_scope = excluded.entity_scope,
  input_kind = excluded.input_kind,
  label = excluded.label,
  prompt = excluded.prompt,
  placeholder = excluded.placeholder,
  default_sort_order = excluded.default_sort_order,
  default_enabled = excluded.default_enabled,
  supports_required = excluded.supports_required,
  is_active = excluded.is_active,
  updated_at = now();

create table if not exists public.company_messenger_field_settings (
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null check (provider in ('telegram')),
  field_key text not null,
  is_enabled boolean not null default true,
  is_required boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, provider, field_key),
  foreign key (provider, field_key)
    references public.messenger_field_catalog(provider, field_key)
    on delete cascade
);

drop trigger if exists trg_company_messenger_field_settings_updated_at on public.company_messenger_field_settings;
create trigger trg_company_messenger_field_settings_updated_at
before update on public.company_messenger_field_settings
for each row execute function public.set_row_updated_at();

create table if not exists public.messenger_conversations (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('telegram')),
  external_chat_id text not null,
  external_user_id text null,
  external_username text null,
  company_id uuid null references public.companies(id) on delete cascade,
  integration_id uuid null references public.messenger_integrations(id) on delete cascade,
  status text not null default 'idle' check (status in ('idle', 'collecting', 'confirming', 'completed', 'blocked')),
  current_field_key text null,
  state jsonb not null default '{}'::jsonb,
  last_order_id uuid null references public.orders(id) on delete set null,
  last_client_id uuid null references public.clients(id) on delete set null,
  last_object_id uuid null references public.client_objects(id) on delete set null,
  started_at timestamptz null,
  completed_at timestamptz null,
  last_message_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_chat_id)
);

create index if not exists messenger_conversations_company_idx
  on public.messenger_conversations(company_id, provider);

drop trigger if exists trg_messenger_conversations_updated_at on public.messenger_conversations;
create trigger trg_messenger_conversations_updated_at
before update on public.messenger_conversations
for each row execute function public.set_row_updated_at();

create table if not exists public.messenger_update_log (
  provider text not null check (provider in ('telegram')),
  external_update_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, external_update_id)
);

alter table public.messenger_integrations enable row level security;
alter table public.messenger_field_catalog enable row level security;
alter table public.company_messenger_field_settings enable row level security;
alter table public.messenger_conversations enable row level security;
alter table public.messenger_update_log enable row level security;

commit;
