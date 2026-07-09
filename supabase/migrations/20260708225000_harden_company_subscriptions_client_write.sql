-- Subscription rows drive paid access and license limits. Authenticated clients
-- may read their own company subscription, but direct writes must go through
-- audited SECURITY DEFINER RPCs or service-role billing/webhook flows.

drop policy if exists company_subscriptions_owner_write on public.company_subscriptions;

drop policy if exists company_subscriptions_select_company on public.company_subscriptions;
create policy company_subscriptions_select_company
on public.company_subscriptions
for select
to authenticated
using (
  public.is_super_admin()
  or public.is_company_owner(company_id)
  or company_id = public.user_company_id()
);

drop policy if exists company_subscriptions_no_direct_insert on public.company_subscriptions;
create policy company_subscriptions_no_direct_insert
on public.company_subscriptions
for insert
to authenticated
with check (false);

drop policy if exists company_subscriptions_no_direct_update on public.company_subscriptions;
create policy company_subscriptions_no_direct_update
on public.company_subscriptions
for update
to authenticated
using (false)
with check (false);

drop policy if exists company_subscriptions_no_direct_delete on public.company_subscriptions;
create policy company_subscriptions_no_direct_delete
on public.company_subscriptions
for delete
to authenticated
using (false);

revoke insert, update, delete on table public.company_subscriptions from authenticated;
grant select on table public.company_subscriptions to authenticated;
