begin;

-- 1) Security hardening: integrations are backend-owned config.
revoke all on table public.messenger_integrations from anon;
revoke all on table public.messenger_integrations from authenticated;

grant select, insert, update, delete on table public.messenger_integrations to service_role;

drop policy if exists messenger_integrations_service_role_all on public.messenger_integrations;
create policy messenger_integrations_service_role_all
on public.messenger_integrations
for all
to service_role
using (true)
with check (true);

-- 2) Normalize existing rows before enforcing strict checks.
update public.messenger_integrations
set
  provider = lower(btrim(provider)),
  onboarding_token = lower(btrim(onboarding_token)),
  destination_type = lower(btrim(destination_type)),
  existing_client_policy = lower(btrim(existing_client_policy)),
  existing_object_policy = lower(btrim(existing_object_policy)),
  welcome_message = nullif(btrim(welcome_message), ''),
  success_message = nullif(btrim(success_message), ''),
  failure_message = nullif(btrim(failure_message), ''),
  updated_at = now();

-- 3) Integrity checks for deterministic behavior.
alter table public.messenger_integrations
  drop constraint if exists messenger_integrations_provider_nonempty_check,
  drop constraint if exists messenger_integrations_onboarding_token_nonempty_check,
  drop constraint if exists messenger_integrations_onboarding_token_format_check,
  drop constraint if exists messenger_integrations_destination_user_required_check,
  drop constraint if exists messenger_integrations_destination_user_for_feed_check,
  drop constraint if exists messenger_integrations_welcome_message_not_blank_check,
  drop constraint if exists messenger_integrations_success_message_not_blank_check,
  drop constraint if exists messenger_integrations_failure_message_not_blank_check;

alter table public.messenger_integrations
  add constraint messenger_integrations_provider_nonempty_check
    check (btrim(provider) <> ''),
  add constraint messenger_integrations_onboarding_token_nonempty_check
    check (btrim(onboarding_token) <> ''),
  add constraint messenger_integrations_onboarding_token_format_check
    check (onboarding_token ~ '^[a-f0-9]{24}$'),
  add constraint messenger_integrations_destination_user_required_check
    check ((destination_type <> 'assignee') or (destination_user_id is not null)),
  add constraint messenger_integrations_destination_user_for_feed_check
    check ((destination_type <> 'feed') or (destination_user_id is null)),
  add constraint messenger_integrations_welcome_message_not_blank_check
    check (welcome_message is null or btrim(welcome_message) <> ''),
  add constraint messenger_integrations_success_message_not_blank_check
    check (success_message is null or btrim(success_message) <> ''),
  add constraint messenger_integrations_failure_message_not_blank_check
    check (failure_message is null or btrim(failure_message) <> '');

commit;
