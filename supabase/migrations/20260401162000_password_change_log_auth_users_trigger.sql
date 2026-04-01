begin;

create or replace function public.log_password_change_from_auth_users()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := null;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.encrypted_password is not distinct from old.encrypted_password then
    return new;
  end if;

  begin
    v_actor := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  exception
    when others then
      v_actor := null;
  end;

  -- De-dup small race window with app-level logging.
  if exists (
    select 1
    from public.password_change_log l
    where l.user_id = new.id
      and l.changed_at > now() - interval '5 seconds'
  ) then
    return new;
  end if;

  insert into public.password_change_log(
    user_id,
    changed_at,
    changed_by,
    ip_address,
    user_agent,
    notes,
    created_at
  )
  values (
    new.id,
    now(),
    case when v_actor = new.id then v_actor else coalesce(v_actor, new.id) end,
    null,
    null,
    'auth.users trigger',
    now()
  );

  return new;
end;
$$;

drop trigger if exists trg_auth_users_password_change_log on auth.users;
create trigger trg_auth_users_password_change_log
after update of encrypted_password on auth.users
for each row
execute function public.log_password_change_from_auth_users();

commit;
