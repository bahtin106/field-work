set search_path = public;

-- 1) Anonymous role should not have direct data/API surface in public schema.
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

-- 2) Authenticated users never need DDL-like table rights.
do $$
declare
  r record;
begin
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p','v','m')
  loop
    execute format('revoke truncate, references, trigger on %I.%I from authenticated', r.nspname, r.relname);
  end loop;
end;
$$;

-- 3) Future-proof defaults for newly created objects in public schema.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon;
