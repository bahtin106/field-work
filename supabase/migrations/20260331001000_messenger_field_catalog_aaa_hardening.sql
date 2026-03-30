begin;

-- 1) Defense-in-depth: no anonymous writes to system catalog.
revoke all on table public.messenger_field_catalog from anon;
revoke all on table public.messenger_field_catalog from authenticated;

grant select on table public.messenger_field_catalog to authenticated;
grant select on table public.messenger_field_catalog to service_role;

drop policy if exists messenger_field_catalog_select_authenticated on public.messenger_field_catalog;
create policy messenger_field_catalog_select_authenticated
on public.messenger_field_catalog
for select
to authenticated
using (true);

drop policy if exists messenger_field_catalog_select_service_role on public.messenger_field_catalog;
create policy messenger_field_catalog_select_service_role
on public.messenger_field_catalog
for select
to service_role
using (true);

-- 2) Normalize legacy rows once before enforcing strict checks.
update public.messenger_field_catalog
set
  provider = lower(btrim(provider)),
  field_key = lower(btrim(field_key)),
  entity_scope = lower(btrim(entity_scope)),
  input_kind = lower(btrim(input_kind)),
  label = btrim(label),
  prompt = btrim(prompt),
  placeholder = nullif(btrim(placeholder), ''),
  updated_at = now();

-- 3) Integrity checks for long-term schema stability.
alter table public.messenger_field_catalog
  drop constraint if exists messenger_field_catalog_field_key_nonempty_check,
  drop constraint if exists messenger_field_catalog_field_key_format_check,
  drop constraint if exists messenger_field_catalog_input_kind_nonempty_check,
  drop constraint if exists messenger_field_catalog_input_kind_known_check,
  drop constraint if exists messenger_field_catalog_label_nonempty_check,
  drop constraint if exists messenger_field_catalog_prompt_nonempty_check,
  drop constraint if exists messenger_field_catalog_default_sort_order_nonnegative_check,
  drop constraint if exists messenger_field_catalog_placeholder_not_blank_check;

alter table public.messenger_field_catalog
  add constraint messenger_field_catalog_field_key_nonempty_check
    check (btrim(field_key) <> ''),
  add constraint messenger_field_catalog_field_key_format_check
    check (field_key ~ '^[a-z][a-z0-9_]*$'),
  add constraint messenger_field_catalog_input_kind_nonempty_check
    check (btrim(input_kind) <> ''),
  add constraint messenger_field_catalog_input_kind_known_check
    check (input_kind in ('text', 'phone', 'multiline')),
  add constraint messenger_field_catalog_label_nonempty_check
    check (btrim(label) <> ''),
  add constraint messenger_field_catalog_prompt_nonempty_check
    check (btrim(prompt) <> ''),
  add constraint messenger_field_catalog_default_sort_order_nonnegative_check
    check (default_sort_order >= 0),
  add constraint messenger_field_catalog_placeholder_not_blank_check
    check (placeholder is null or btrim(placeholder) <> '');

-- 4) Hot-path index for catalog reads in telegram-bot edge function.
create index if not exists messenger_field_catalog_read_idx
  on public.messenger_field_catalog (provider, is_active, default_sort_order, field_key);

commit;
