-- Reconcile stale auth rows before creating a new invited user.
-- Removes auth.users records for the same email when there is no matching profile,
-- and cleans orphan identities.

create or replace function public.reconcile_email_before_invite(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_exists_with_profile boolean := false;
  v_deleted_users int := 0;
begin
  if v_email = '' then
    return jsonb_build_object('status', 'ok', 'deleted_users', 0);
  end if;

  select exists (
    select 1
    from auth.users u
    where lower(u.email) = v_email
      and exists (select 1 from public.profiles p where p.id = u.id)
  )
  into v_exists_with_profile;

  if v_exists_with_profile then
    return jsonb_build_object('status', 'exists', 'deleted_users', 0);
  end if;

  delete from auth.users u
  where lower(u.email) = v_email
    and not exists (select 1 from public.profiles p where p.id = u.id);
  get diagnostics v_deleted_users = row_count;

  -- Clean identities left without user after delete.
  perform public.cleanup_auth_identity_orphans(v_email, null);

  return jsonb_build_object('status', 'ok', 'deleted_users', v_deleted_users);
end;
$$;

revoke all on function public.reconcile_email_before_invite(text) from public;
grant execute on function public.reconcile_email_before_invite(text) to service_role;
