begin;

drop function if exists public.app_can_view_field(uuid, text, text, timestamptz, timestamptz, timestamptz);
drop function if exists public.can_view_phone(uuid, timestamptz);
drop function if exists public.can_view_phone(uuid, timestamptz, boolean);
drop function if exists public.can_view_phone(uuid, timestamptz, text);

drop policy if exists insert_field_visibility_admin_only on public.app_field_visibility;
drop policy if exists select_field_visibility on public.app_field_visibility;
drop policy if exists update_field_visibility_admin_only on public.app_field_visibility;

drop table if exists public.app_field_visibility;

commit;
