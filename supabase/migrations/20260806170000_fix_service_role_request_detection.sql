begin;

-- PostgREST stores current JWT claims in request.jwt.claims. Older deployments
-- also populated request.jwt.claim.role, but that legacy setting is not
-- guaranteed to exist. Keep one canonical role resolver for policies,
-- triggers, RPCs, Edge Functions, and direct administrative connections.
create or replace function public.effective_request_role()
returns text
language sql
stable
set search_path = pg_catalog, public, auth
as $$
  select case
    when current_user::text = 'service_role'
      or session_user::text = 'service_role'
      then 'service_role'
    else coalesce(auth.role(), '')
  end;
$$;

comment on function public.effective_request_role() is
  'Returns the effective API role from the current database role or modern/legacy PostgREST JWT claims.';

revoke all on function public.effective_request_role()
  from public;
grant execute on function public.effective_request_role()
  to anon, authenticated, service_role, supabase_admin;

-- Replace every remaining direct read of the obsolete single-claim GUC in
-- existing public functions. CREATE OR REPLACE preserves function identities,
-- dependencies, owners, grants, and SECURITY DEFINER attributes.
do $migration$
declare
  function_row record;
  original_definition text;
  patched_definition text;
begin
  for function_row in
    select procedure.oid,
           namespace.nspname,
           procedure.proname,
           pg_get_function_identity_arguments(procedure.oid) as identity_arguments
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.prosrc ilike '%request.jwt.claim.role%'
     order by procedure.oid
  loop
    original_definition := pg_get_functiondef(function_row.oid);
    patched_definition := regexp_replace(
      original_definition,
      'coalesce[[:space:]]*\([[:space:]]*current_setting[[:space:]]*\([[:space:]]*''request\.jwt\.claim\.role''[[:space:]]*,[[:space:]]*true[[:space:]]*\)[[:space:]]*,[[:space:]]*''''[[:space:]]*\)',
      'public.effective_request_role()',
      'gi'
    );

    if patched_definition = original_definition then
      raise exception
        'Could not update legacy request role lookup in %.%(%)',
        function_row.nspname,
        function_row.proname,
        function_row.identity_arguments;
    end if;

    execute patched_definition;
  end loop;

  if exists (
    select 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.prosrc ilike '%request.jwt.claim.role%'
  ) then
    raise exception 'Legacy request.jwt.claim.role lookups remain in public functions';
  end if;
end;
$migration$;

-- The service role is the administrative client used by Edge Functions. It
-- must retain table privileges even though it bypasses RLS.
grant select, insert, update, delete
  on table public.app_role_permissions
  to service_role;

notify pgrst, 'reload schema';

commit;
