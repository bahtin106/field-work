-- A regular authenticated user only needs their own company settings/name.
-- Super admins keep cross-company visibility for support/admin workflows.
drop policy if exists "All can read companies" on public.companies;

create policy companies_select_own_or_super_admin
on public.companies
for select
to authenticated
using (
  id = public.user_company_id()
  or public.is_super_admin()
);
