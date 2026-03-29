begin;

-- 1) Temporal integrity: revoke time cannot be earlier than assign time.
alter table public.company_seat_assignments
  drop constraint if exists company_seat_assignments_revoked_after_assigned_check;

alter table public.company_seat_assignments
  add constraint company_seat_assignments_revoked_after_assigned_check
  check (revoked_at is null or revoked_at >= assigned_at);

-- 2) Cross-table integrity on writes: seat company must match profile company.
create or replace function public.tg_company_seat_assignments_validate_company_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_company_id uuid;
begin
  select p.company_id
    into v_profile_company_id
    from public.profiles p
   where p.id = new.user_id;

  if v_profile_company_id is null then
    raise exception 'PROFILE_NOT_FOUND_OR_COMPANY_EMPTY';
  end if;

  if v_profile_company_id is distinct from new.company_id then
    raise exception 'SEAT_COMPANY_USER_MISMATCH';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_company_seat_assignments_validate_company_user on public.company_seat_assignments;
create trigger trg_company_seat_assignments_validate_company_user
before insert or update of company_id, user_id
on public.company_seat_assignments
for each row
execute function public.tg_company_seat_assignments_validate_company_user();

commit;

