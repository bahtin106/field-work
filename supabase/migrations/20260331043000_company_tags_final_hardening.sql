begin;

-- 1) Defense-in-depth grants.
revoke all on table public.company_tags from anon;
grant select, insert, update, delete on table public.company_tags to authenticated;
grant select, insert, update, delete on table public.company_tags to service_role;

drop policy if exists company_tags_service_role_all on public.company_tags;
create policy company_tags_service_role_all
on public.company_tags
for all
to service_role
using (true)
with check (true);

-- 2) Keep DB invariants aligned with frontend limits.
alter table public.company_tags
  drop constraint if exists company_tags_value_len_check,
  drop constraint if exists company_tags_normalized_len_check;

alter table public.company_tags
  add constraint company_tags_value_len_check
    check (char_length(value) <= 64),
  add constraint company_tags_normalized_len_check
    check (char_length(normalized_value) <= 64);

commit;
