begin;

-- 1) Restrict worker RPC to backend role only.
revoke execute on function public.get_notification_prefs_bulk(uuid[]) from public;
revoke execute on function public.get_notification_prefs_bulk(uuid[]) from anon;
revoke execute on function public.get_notification_prefs_bulk(uuid[]) from authenticated;
grant execute on function public.get_notification_prefs_bulk(uuid[]) to service_role;

-- 2) Strict timezone validation/normalization at DB layer.
create or replace function public.notification_prefs_validate_timezone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.quiet_timezone := coalesce(nullif(btrim(new.quiet_timezone), ''), 'UTC');

  if not exists (
    select 1
    from pg_timezone_names tzn
    where tzn.name = new.quiet_timezone
  ) then
    raise exception using
      errcode = '22023',
      message = format('Invalid quiet_timezone: %s', new.quiet_timezone);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notification_prefs_validate_timezone on public.notification_prefs;
create trigger trg_notification_prefs_validate_timezone
before insert or update of quiet_timezone
on public.notification_prefs
for each row
execute function public.notification_prefs_validate_timezone();

-- Optional stricter quiet window rule: same start/end is ambiguous.
alter table public.notification_prefs
  drop constraint if exists notification_prefs_quiet_window_not_equal_check,
  add constraint notification_prefs_quiet_window_not_equal_check
    check (quiet_start is null or quiet_end is null or quiet_start <> quiet_end);

commit;
