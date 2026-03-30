begin;

drop policy if exists "Users manage own notification prefs" on public.notification_prefs;

commit;
