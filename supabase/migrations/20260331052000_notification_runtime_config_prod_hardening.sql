begin;

-- 1) Access hardening for sensitive runtime config.
revoke all on table public.notification_runtime_config from anon;
revoke all on table public.notification_runtime_config from authenticated;
revoke all on table public.notification_runtime_config from service_role;

grant select, insert, update, delete on table public.notification_runtime_config to service_role;

alter table public.notification_runtime_config enable row level security;

drop policy if exists notification_runtime_config_service_role_all on public.notification_runtime_config;
create policy notification_runtime_config_service_role_all
on public.notification_runtime_config
for all
to service_role
using (true)
with check (true);

-- 2) Normalize values before strict checks.
update public.notification_runtime_config
set
  push_send_url = nullif(btrim(push_send_url), ''),
  push_worker_key = nullif(btrim(push_worker_key), '');

-- 3) Strict config invariants.
alter table public.notification_runtime_config
  drop constraint if exists notification_runtime_config_url_https_check,
  drop constraint if exists notification_runtime_config_url_nonblank_if_set_check,
  drop constraint if exists notification_runtime_config_worker_key_nonblank_check,
  drop constraint if exists notification_runtime_config_enabled_requires_url_check;

alter table public.notification_runtime_config
  add constraint notification_runtime_config_url_https_check
    check (push_send_url is null or push_send_url ~ '^https://[^[:space:]]+$'),
  add constraint notification_runtime_config_url_nonblank_if_set_check
    check (push_send_url is null or btrim(push_send_url) <> ''),
  add constraint notification_runtime_config_worker_key_nonblank_check
    check (push_worker_key is null or btrim(push_worker_key) <> ''),
  add constraint notification_runtime_config_enabled_requires_url_check
    check ((not enabled) or (push_send_url is not null and btrim(push_send_url) <> ''));

commit;
