set search_path = public;

-- Performance advisor optimization:
-- force initplan evaluation for auth/current_setting dependent helpers
-- by wrapping them with (select ...).
drop policy if exists profiles_update_scope_merged on public.profiles;

create policy profiles_update_scope_merged
on public.profiles
as permissive
for update
to authenticated
using (
  (select public.is_super_admin())
  or (
    (select public.is_admin_or_dispatcher())
    and company_id = (select public.user_company_id())
  )
  or (id = (select auth.uid()))
)
with check (
  (select public.is_super_admin())
  or (
    (select public.is_admin_or_dispatcher())
    and company_id = (select public.user_company_id())
  )
  or (
    id = (select auth.uid())
    and public.profiles_self_update_guard(
      role,
      company_id,
      department_id,
      email,
      is_admin_blocked,
      license_state,
      blocked_reason
    )
  )
);

