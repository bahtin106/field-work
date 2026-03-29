begin;

-- Access hardening: this table is maintained by backend service flows.
revoke all on table public.company_messenger_field_settings from anon, authenticated;
grant select, insert, update, delete on table public.company_messenger_field_settings to service_role;

-- Data integrity hardening.
alter table public.company_messenger_field_settings
  drop constraint if exists company_messenger_field_settings_required_implies_enabled_check;

alter table public.company_messenger_field_settings
  add constraint company_messenger_field_settings_required_implies_enabled_check
  check ((is_required = false) or (is_enabled = true));

alter table public.company_messenger_field_settings
  drop constraint if exists company_messenger_field_settings_sort_order_non_negative_check;

alter table public.company_messenger_field_settings
  add constraint company_messenger_field_settings_sort_order_non_negative_check
  check (sort_order >= 0);

commit;

