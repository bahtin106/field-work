-- Prevent infinite trigger recursion when profile is admin-blocked.
-- The previous implementation updated license_state unconditionally inside
-- trg_profiles_license_after, which could re-fire the same trigger endlessly.

create or replace function public.trg_profiles_license_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.company_id is distinct from new.company_id and old.company_id is not null then
    update public.company_seat_assignments
    set revoked_at = now(), reason = 'moved_company'
    where company_id = old.company_id
      and user_id = new.id
      and revoked_at is null;
  end if;

  if coalesce(new.is_admin_blocked, false) then
    update public.company_seat_assignments
    set revoked_at = now(), reason = 'admin_block'
    where company_id = new.company_id
      and user_id = new.id
      and revoked_at is null;

    -- Recursion guard: only perform profile UPDATE when value actually changes.
    if coalesce(new.license_state, 'active') <> 'blocked_by_license' then
      update public.profiles
      set license_state = 'blocked_by_license'
      where id = new.id
        and coalesce(license_state, 'active') <> 'blocked_by_license';
    end if;

    return new;
  end if;

  if coalesce(new.license_state, 'active') = 'active' then
    if not public.user_has_active_seat(new.company_id, new.id) then
      if public.can_company_add_member(new.company_id) then
        insert into public.company_seat_assignments(company_id, user_id, reason)
        values (new.company_id, new.id, 'manual')
        on conflict do nothing;
      else
        update public.profiles
        set
          license_state = 'blocked_by_license',
          blocked_reason = 'no_paid_seat'
        where id = new.id;
      end if;
    end if;
  else
    update public.company_seat_assignments
    set revoked_at = now(), reason = coalesce(new.blocked_reason, 'license_block')
    where company_id = new.company_id
      and user_id = new.id
      and revoked_at is null;
  end if;

  return new;
end;
$$;

