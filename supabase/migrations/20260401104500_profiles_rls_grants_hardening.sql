-- Profiles security hardening: RLS policies and grants.

alter table public.profiles enable row level security;

-- Remove legacy/overlapping policies.
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists profiles_insert_self on public.profiles;
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists select_profiles_all on public.profiles;
drop policy if exists insert_own_profile on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists profiles_delete_admin on public.profiles;

-- Read access: own profile, company colleagues, or super admin.
create policy profiles_select_scope
on public.profiles
for select
to authenticated
using (
  public.is_super_admin()
  or id = auth.uid()
  or (
    auth.uid() is not null
    and company_id is not null
    and company_id = public.user_company_id()
  )
);

-- Insert only own profile.
create policy profiles_insert_self
on public.profiles
for insert
to authenticated
with check (
  auth.uid() is not null
  and id = auth.uid()
);

-- Self update: allow only non-privileged fields.
create policy profiles_update_self_guarded
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and role is not distinct from (select p.role from public.profiles p where p.id = auth.uid())
  and company_id is not distinct from (select p.company_id from public.profiles p where p.id = auth.uid())
  and department_id is not distinct from (select p.department_id from public.profiles p where p.id = auth.uid())
  and email is not distinct from (select p.email from public.profiles p where p.id = auth.uid())
  and is_suspended is not distinct from (select p.is_suspended from public.profiles p where p.id = auth.uid())
  and suspended_at is not distinct from (select p.suspended_at from public.profiles p where p.id = auth.uid())
  and suspend_reason is not distinct from (select p.suspend_reason from public.profiles p where p.id = auth.uid())
  and is_admin_blocked is not distinct from (select p.is_admin_blocked from public.profiles p where p.id = auth.uid())
  and license_state is not distinct from (select p.license_state from public.profiles p where p.id = auth.uid())
  and blocked_reason is not distinct from (select p.blocked_reason from public.profiles p where p.id = auth.uid())
);

-- Admin/dispatcher can update rows in own company. Super admin can update any row.
create policy profiles_update_admin_scope
on public.profiles
for update
to authenticated
using (
  public.is_super_admin()
  or (
    public.is_admin_or_dispatcher()
    and company_id = public.user_company_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.is_admin_or_dispatcher()
    and company_id = public.user_company_id()
  )
);

-- Admin/dispatcher can delete non-self rows in own company. Super admin can delete any non-self row.
create policy profiles_delete_admin_scope
on public.profiles
for delete
to authenticated
using (
  (public.is_super_admin() or (public.is_admin_or_dispatcher() and company_id = public.user_company_id()))
  and id <> auth.uid()
);

-- Tighten table grants.
revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.profiles to service_role;
