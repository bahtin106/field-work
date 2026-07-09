-- Add MAX as a first-class request messenger provider.
-- The migration is intentionally idempotent and keeps existing Telegram behavior unchanged.

alter table public.messenger_integrations
  drop constraint if exists messenger_integrations_provider_check;
alter table public.messenger_integrations
  add constraint messenger_integrations_provider_check
  check (provider = any (array['telegram'::text, 'max'::text]));

alter table public.messenger_field_catalog
  drop constraint if exists messenger_field_catalog_provider_check;
alter table public.messenger_field_catalog
  add constraint messenger_field_catalog_provider_check
  check (provider = any (array['telegram'::text, 'max'::text]));

alter table public.company_messenger_field_settings
  drop constraint if exists company_messenger_field_settings_provider_check;
alter table public.company_messenger_field_settings
  add constraint company_messenger_field_settings_provider_check
  check (provider = any (array['telegram'::text, 'max'::text]));

alter table public.messenger_conversations
  drop constraint if exists messenger_conversations_provider_check;
alter table public.messenger_conversations
  add constraint messenger_conversations_provider_check
  check (provider = any (array['telegram'::text, 'max'::text]));

alter table public.messenger_update_log
  drop constraint if exists messenger_update_log_provider_check;
alter table public.messenger_update_log
  add constraint messenger_update_log_provider_check
  check (provider = any (array['telegram'::text, 'max'::text]));

alter table public.messenger_update_log
  drop constraint if exists messenger_update_log_external_update_id_numeric_check;
alter table public.messenger_update_log
  drop constraint if exists messenger_update_log_external_update_id_format_check;
alter table public.messenger_update_log
  add constraint messenger_update_log_external_update_id_format_check
  check (
    provider <> 'telegram'::text
    or external_update_id ~ '^[0-9]+$'::text
  );

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
  is_active,
  created_at,
  updated_at
)
select
  'max'::text,
  field_key,
  entity_scope,
  input_kind,
  label,
  prompt,
  placeholder,
  default_sort_order,
  default_enabled,
  supports_required,
  is_active,
  now(),
  now()
from public.messenger_field_catalog
where provider = 'telegram'
on conflict (provider, field_key) do update set
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

insert into public.company_messenger_field_settings (
  company_id,
  provider,
  field_key,
  is_enabled,
  is_required,
  sort_order,
  created_at,
  updated_at
)
select
  company_id,
  'max'::text,
  field_key,
  is_enabled,
  is_required,
  sort_order,
  now(),
  now()
from public.company_messenger_field_settings
where provider = 'telegram'
on conflict (company_id, provider, field_key) do nothing;

insert into public.messenger_integrations (
  company_id,
  provider,
  is_enabled,
  destination_type,
  destination_user_id,
  create_client,
  existing_client_policy,
  create_object,
  existing_object_policy,
  welcome_message,
  success_message,
  failure_message,
  created_at,
  updated_at
)
select
  c.id,
  'max'::text,
  false,
  case
    when t.destination_type = 'assignee' and t.destination_user_id is not null then 'assignee'
    else 'feed'
  end,
  case
    when t.destination_type = 'assignee' and t.destination_user_id is not null then t.destination_user_id
    else null
  end,
  coalesce(t.create_client, true),
  coalesce(t.existing_client_policy, 'reuse'),
  coalesce(t.create_object, true),
  coalesce(t.existing_object_policy, 'reuse_or_create'),
  t.welcome_message,
  t.success_message,
  t.failure_message,
  now(),
  now()
from public.companies c
left join public.messenger_integrations t
  on t.company_id = c.id
 and t.provider = 'telegram'
on conflict (company_id, provider) do nothing;
