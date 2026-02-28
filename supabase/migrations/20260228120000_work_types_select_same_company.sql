-- Allow all authenticated users from the same company to read work types.
-- Editing remains restricted to admins/dispatchers by existing INSERT/UPDATE/DELETE policies.

drop policy if exists work_types_select_admins on public.work_types;

create policy work_types_select_same_company
  on public.work_types
  for select
  to authenticated
  using (company_id = user_company_id());
