set search_path = public;

-- companies: keep broad authenticated read policy; drop redundant narrower SELECT policy.
drop policy if exists "companies tz select same company" on public.companies;

-- company_finance_rules: write policy already covers SELECT with the same predicate.
drop policy if exists "company_finance_rules_select_company" on public.company_finance_rules;

-- company_subscriptions: owner_write already covers SELECT with the same predicate.
drop policy if exists "company_subscriptions_select_owner" on public.company_subscriptions;

-- company_seat_assignments: replace FOR ALL deny policy with write-only deny policies.
create policy "company_seat_assignments_no_direct_insert"
on public.company_seat_assignments
as permissive
for insert
to authenticated
with check (false);

create policy "company_seat_assignments_no_direct_update"
on public.company_seat_assignments
as permissive
for update
to authenticated
using (false)
with check (false);

create policy "company_seat_assignments_no_direct_delete"
on public.company_seat_assignments
as permissive
for delete
to authenticated
using (false);

drop policy if exists "company_seat_assignments_no_direct_write" on public.company_seat_assignments;

-- order_finance_entries: split FOR ALL write policy into per-command write policies
-- to avoid overlap with dedicated SELECT visibility policy.
create policy "order_finance_entries_insert_company"
on public.order_finance_entries
as permissive
for insert
to authenticated
with check (
  (company_id = user_company_id())
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditFinanceEntries',
    finance_permission_default(user_role(), 'canEditFinanceEntries')
  )
);

create policy "order_finance_entries_update_company"
on public.order_finance_entries
as permissive
for update
to authenticated
using (
  (company_id = user_company_id())
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditFinanceEntries',
    finance_permission_default(user_role(), 'canEditFinanceEntries')
  )
)
with check (
  (company_id = user_company_id())
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditFinanceEntries',
    finance_permission_default(user_role(), 'canEditFinanceEntries')
  )
);

create policy "order_finance_entries_delete_company"
on public.order_finance_entries
as permissive
for delete
to authenticated
using (
  (company_id = user_company_id())
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditFinanceEntries',
    finance_permission_default(user_role(), 'canEditFinanceEntries')
  )
);

drop policy if exists "order_finance_entries_write_company" on public.order_finance_entries;

-- profiles: merge two UPDATE permissive policies into one equivalent OR policy.
create policy "profiles_update_scope_merged"
on public.profiles
as permissive
for update
to authenticated
using (
  is_super_admin()
  or (is_admin_or_dispatcher() and company_id = user_company_id())
  or (id = (select auth.uid()))
)
with check (
  is_super_admin()
  or (is_admin_or_dispatcher() and company_id = user_company_id())
  or (
    (id = (select auth.uid()))
    and not (
      role is distinct from (
        select p.role from public.profiles p where p.id = (select auth.uid())
      )
    )
    and not (
      company_id is distinct from (
        select p.company_id from public.profiles p where p.id = (select auth.uid())
      )
    )
    and not (
      department_id is distinct from (
        select p.department_id from public.profiles p where p.id = (select auth.uid())
      )
    )
    and not (
      email is distinct from (
        select p.email from public.profiles p where p.id = (select auth.uid())
      )
    )
    and not (
      is_admin_blocked is distinct from (
        select p.is_admin_blocked from public.profiles p where p.id = (select auth.uid())
      )
    )
    and not (
      license_state is distinct from (
        select p.license_state from public.profiles p where p.id = (select auth.uid())
      )
    )
    and not (
      blocked_reason is distinct from (
        select p.blocked_reason from public.profiles p where p.id = (select auth.uid())
      )
    )
  )
);

drop policy if exists "profiles_update_admin_scope" on public.profiles;
drop policy if exists "profiles_update_self_guarded" on public.profiles;
