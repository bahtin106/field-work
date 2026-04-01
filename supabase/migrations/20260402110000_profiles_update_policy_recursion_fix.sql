set search_path = public;

-- Prevent RLS self-recursion on profiles UPDATE policy by moving
-- self-guard comparisons into a SECURITY DEFINER helper.
create or replace function public.profiles_self_update_guard(
  p_role text,
  p_company_id uuid,
  p_department_id uuid,
  p_email text,
  p_is_admin_blocked boolean,
  p_license_state text,
  p_blocked_reason text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p_role is not distinct from p.role
        and p_company_id is not distinct from p.company_id
        and p_department_id is not distinct from p.department_id
        and p_email is not distinct from p.email
        and p_is_admin_blocked is not distinct from p.is_admin_blocked
        and p_license_state is not distinct from p.license_state
        and p_blocked_reason is not distinct from p.blocked_reason
    );
$$;

revoke all on function public.profiles_self_update_guard(text, uuid, uuid, text, boolean, text, text) from public;
grant execute on function public.profiles_self_update_guard(text, uuid, uuid, text, boolean, text, text) to authenticated;
grant execute on function public.profiles_self_update_guard(text, uuid, uuid, text, boolean, text, text) to service_role;

drop policy if exists profiles_update_scope_merged on public.profiles;

create policy profiles_update_scope_merged
on public.profiles
as permissive
for update
to authenticated
using (
  is_super_admin()
  or (is_admin_or_dispatcher() and company_id = user_company_id())
  or (id = auth.uid())
)
with check (
  is_super_admin()
  or (is_admin_or_dispatcher() and company_id = user_company_id())
  or (
    id = auth.uid()
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

