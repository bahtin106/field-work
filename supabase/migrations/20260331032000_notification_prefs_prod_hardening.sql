begin;

-- 1) Security hardening (RLS remains the primary guard).
revoke all on table public.notification_prefs from anon;
revoke all on table public.notification_prefs from authenticated;
grant select, insert, update on table public.notification_prefs to authenticated;
grant select, insert, update, delete on table public.notification_prefs to service_role;

drop policy if exists notification_prefs_service_role_all on public.notification_prefs;
create policy notification_prefs_service_role_all
on public.notification_prefs
for all
to service_role
using (true)
with check (true);

-- 2) Data normalization.
update public.notification_prefs
set quiet_timezone = 'UTC'
where quiet_timezone is null or btrim(quiet_timezone) = '';

-- Remove orphan prefs for deleted auth users (cannot be applied/used).
delete from public.notification_prefs np
where not exists (
  select 1 from auth.users u where u.id = np.user_id
);

-- 3) Integrity constraints and FK navigation.
alter table public.notification_prefs
  alter column quiet_timezone set default 'UTC',
  alter column quiet_timezone set not null;

alter table public.notification_prefs
  drop constraint if exists notification_prefs_quiet_timezone_nonblank_check,
  drop constraint if exists notification_prefs_quiet_window_pair_check,
  drop constraint if exists notification_prefs_user_id_fkey;

alter table public.notification_prefs
  add constraint notification_prefs_quiet_timezone_nonblank_check
    check (btrim(quiet_timezone) <> ''),
  add constraint notification_prefs_quiet_window_pair_check
    check (
      (quiet_start is null and quiet_end is null)
      or
      (quiet_start is not null and quiet_end is not null)
    ),
  add constraint notification_prefs_user_id_fkey
    foreign key (user_id)
    references auth.users(id)
    on delete cascade;

commit;
