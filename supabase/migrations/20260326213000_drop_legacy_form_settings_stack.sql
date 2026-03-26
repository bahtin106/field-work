-- Remove legacy form-settings stack that was replaced by company_entity_field_settings.
-- Safe/idempotent: all drops are IF EXISTS.

begin;

-- Legacy RPCs used by old SettingsProvider.
drop function if exists public.get_active_settings();
drop function if exists public.get_form_schema(text);
drop function if exists public.get_form_schema();

-- Legacy editor tables.
drop table if exists public.app_form_fields cascade;
drop table if exists public.app_media_requirements cascade;
drop table if exists public.app_view_presets cascade;
drop table if exists public.app_settings_versions cascade;

commit;
