-- Password-change logs contain security metadata (IP/user-agent/change time).
-- A company admin may inspect logs only for users in their current company;
-- users can read their own log; super admins keep global visibility.

drop policy if exists password_change_log_select_own_or_admin on public.password_change_log;

create policy password_change_log_select_scoped
on public.password_change_log
for select
to authenticated
using (
  user_id = (select uid())
  or public.is_super_admin()
  or (
    public.is_admin()
    and exists (
      select 1
      from public.profiles target
      where target.id = password_change_log.user_id
        and target.company_id = public.user_company_id()
    )
  )
);
