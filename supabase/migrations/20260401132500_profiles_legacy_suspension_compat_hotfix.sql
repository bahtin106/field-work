-- Temporary backward-compatibility for old mobile clients still reading/writing
-- profiles.is_suspended / profiles.suspended_at.

alter table public.profiles
  add column if not exists is_suspended boolean not null default false,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspend_reason text;

-- Backfill from canonical state.
update public.profiles
set
  is_suspended = coalesce(is_admin_blocked, false),
  suspended_at = case
    when coalesce(is_admin_blocked, false) then coalesce(suspended_at, now())
    else null
  end,
  suspend_reason = case
    when coalesce(is_admin_blocked, false) then coalesce(nullif(blocked_reason, ''), 'admin_block')
    else null
  end;

create or replace function public.trg_profiles_legacy_suspension_compat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Old clients may update is_suspended -> reflect into canonical field.
  if tg_op = 'UPDATE' and new.is_suspended is distinct from old.is_suspended then
    new.is_admin_blocked := coalesce(new.is_suspended, false);
  end if;

  -- Canonical always wins as source of truth for stored legacy mirror.
  new.is_suspended := coalesce(new.is_admin_blocked, false);

  if coalesce(new.is_admin_blocked, false) then
    new.suspended_at := coalesce(new.suspended_at, old.suspended_at, now());
    if coalesce(nullif(new.suspend_reason, ''), '') = '' then
      new.suspend_reason := coalesce(nullif(new.blocked_reason, ''), 'admin_block');
    end if;
  else
    new.suspended_at := null;
    new.suspend_reason := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_legacy_suspension_compat on public.profiles;
create trigger trg_profiles_legacy_suspension_compat
before insert or update of is_admin_blocked, blocked_reason, is_suspended, suspended_at, suspend_reason
on public.profiles
for each row
execute function public.trg_profiles_legacy_suspension_compat();
