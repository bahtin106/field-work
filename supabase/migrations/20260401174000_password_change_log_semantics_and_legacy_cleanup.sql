begin;

create or replace function public.log_password_change_from_auth_users()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := null;
  v_changed_at timestamptz := coalesce(new.updated_at, now());
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
    v_changed_at,
    case when v_actor = new.id then v_actor else coalesce(v_actor, new.id) end,
    null,
    null,
    'auth.users trigger',
    now()
  );

  return new;
end;
$$;

-- Normalize old rows where source was not written.
update public.password_change_log
set notes = 'legacy:direct_insert'
where coalesce(btrim(notes), '') = '';

-- Drop legacy trigger-only duplicates when a richer row exists for the same event window.
with pairs as (
  select t.id as trigger_id
  from public.password_change_log t
  join public.password_change_log r
    on r.user_id = t.user_id
   and r.id <> t.id
   and abs(extract(epoch from (r.changed_at - t.changed_at))) <= 5
  where t.notes = 'auth.users trigger'
    and coalesce(btrim(t.ip_address), '') = ''
    and coalesce(btrim(t.user_agent), '') = ''
    and (
      coalesce(btrim(r.ip_address), '') <> ''
      or coalesce(btrim(r.user_agent), '') <> ''
      or coalesce(btrim(r.notes), '') <> 'auth.users trigger'
    )
)
delete from public.password_change_log l
using pairs p
where l.id = p.trigger_id;

commit;
