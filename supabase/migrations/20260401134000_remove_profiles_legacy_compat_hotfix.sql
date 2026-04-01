-- Remove temporary compatibility layer for legacy suspension columns.

drop trigger if exists trg_profiles_legacy_suspension_compat on public.profiles;
drop function if exists public.trg_profiles_legacy_suspension_compat();

alter table public.profiles
  drop column if exists is_suspended,
  drop column if exists suspended_at,
  drop column if exists suspend_reason;
