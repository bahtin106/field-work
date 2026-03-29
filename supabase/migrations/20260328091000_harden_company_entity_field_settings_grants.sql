begin;

-- Production hardening:
-- keep access to this table only through SECURITY DEFINER RPCs for client roles.
revoke all on table public.company_entity_field_settings from anon;
revoke all on table public.company_entity_field_settings from authenticated;

-- service_role keeps direct table access for backend/maintenance flows.
grant select, insert, update, delete on table public.company_entity_field_settings to service_role;

commit;

