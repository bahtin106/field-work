begin;

-- 1) Security hardening: update log is backend-only idempotency storage.
revoke all on table public.messenger_update_log from anon;
revoke all on table public.messenger_update_log from authenticated;

grant select, insert, update, delete on table public.messenger_update_log to service_role;

drop policy if exists messenger_update_log_service_role_all on public.messenger_update_log;
create policy messenger_update_log_service_role_all
on public.messenger_update_log
for all
to service_role
using (true)
with check (true);

-- 2) Normalize and validate payload shape.
update public.messenger_update_log
set
  provider = lower(btrim(provider)),
  external_update_id = btrim(external_update_id);

alter table public.messenger_update_log
  drop constraint if exists messenger_update_log_provider_nonempty_check,
  drop constraint if exists messenger_update_log_external_update_id_nonempty_check,
  drop constraint if exists messenger_update_log_external_update_id_numeric_check;

alter table public.messenger_update_log
  add constraint messenger_update_log_provider_nonempty_check
    check (btrim(provider) <> ''),
  add constraint messenger_update_log_external_update_id_nonempty_check
    check (btrim(external_update_id) <> ''),
  add constraint messenger_update_log_external_update_id_numeric_check
    check (external_update_id ~ '^[0-9]+$');

commit;
