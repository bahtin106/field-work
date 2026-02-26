-- Cleanup helper for orphan auth.identities rows left after auth user deletion.
-- Some GoTrue versions can leave identity records without matching auth.users.
-- This helper is called by edge functions during delete/recreate flows.

create or replace function public.cleanup_auth_identity_orphans(
  p_email text default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_deleted int := 0;
begin
  delete from auth.identities i
  where
    (
      p_user_id is not null
      and i.user_id = p_user_id
      and not exists (select 1 from auth.users u where u.id = i.user_id)
    )
    or (
      p_email is not null
      and lower(i.email) = lower(trim(p_email))
      and not exists (select 1 from auth.users u where u.id = i.user_id)
    )
    or (
      p_user_id is null
      and p_email is null
      and not exists (select 1 from auth.users u where u.id = i.user_id)
    );

  get diagnostics v_deleted = row_count;
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

revoke all on function public.cleanup_auth_identity_orphans(text, uuid) from public;
grant execute on function public.cleanup_auth_identity_orphans(text, uuid) to service_role;
