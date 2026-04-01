begin;

drop index if exists public.idx_super_admins_user_active;
drop index if exists public.idx_super_admins_profile_active;

commit;
