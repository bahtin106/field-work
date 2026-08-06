begin;

drop function if exists public.admin_update_profile_super_full_v2(
  uuid, text, text, text, uuid, text, date, text, text, boolean, uuid
);
drop function if exists public.admin_change_company_role_super(uuid, text, uuid);
drop function if exists public.admin_get_company_role_context_super(uuid);

drop trigger if exists trg_profiles_require_company_admin on public.profiles;
drop function if exists public.enforce_company_admin_continuity();

commit;
