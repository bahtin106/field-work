-- Align subscription visibility with company visibility: regular users see
-- only their current profile company; super admins keep global visibility.
drop policy if exists company_subscriptions_select_company on public.company_subscriptions;

create policy company_subscriptions_select_company
on public.company_subscriptions
for select
to authenticated
using (
  public.is_super_admin()
  or company_id = public.user_company_id()
);
