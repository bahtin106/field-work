set search_path = public;

do $$
declare
  r record;
  old_using text;
  old_check text;
  new_using text;
  new_check text;
  sql_stmt text;
begin
  for r in
    select
      n.nspname as schema_name,
      c.relname as table_name,
      pol.polname,
      pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
      pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public'
  loop
    old_using := coalesce(r.using_expr, '');
    old_check := coalesce(r.check_expr, '');

    new_using := old_using;
    new_check := old_check;

    new_using := regexp_replace(new_using, '\(\s*SELECT\s+uid\(\)\s+AS\s+uid\s*\)', '(select auth.uid())', 'gi');
    new_using := regexp_replace(new_using, '\(\s*SELECT\s+role\(\)\s+AS\s+role\s*\)', '(select auth.role())', 'gi');
    new_check := regexp_replace(new_check, '\(\s*SELECT\s+uid\(\)\s+AS\s+uid\s*\)', '(select auth.uid())', 'gi');
    new_check := regexp_replace(new_check, '\(\s*SELECT\s+role\(\)\s+AS\s+role\s*\)', '(select auth.role())', 'gi');

    new_using := regexp_replace(new_using, '(^|[^a-zA-Z_\.])uid\(\)', '\1(select auth.uid())', 'g');
    new_using := regexp_replace(new_using, '(^|[^a-zA-Z_\.])role\(\)', '\1(select auth.role())', 'g');
    new_check := regexp_replace(new_check, '(^|[^a-zA-Z_\.])uid\(\)', '\1(select auth.uid())', 'g');
    new_check := regexp_replace(new_check, '(^|[^a-zA-Z_\.])role\(\)', '\1(select auth.role())', 'g');

    new_using := regexp_replace(new_using, '\(select\s+\(select\s+auth\.uid\(\)\)\s*\)', '(select auth.uid())', 'gi');
    new_using := regexp_replace(new_using, '\(select\s+\(select\s+auth\.role\(\)\)\s*\)', '(select auth.role())', 'gi');
    new_check := regexp_replace(new_check, '\(select\s+\(select\s+auth\.uid\(\)\)\s*\)', '(select auth.uid())', 'gi');
    new_check := regexp_replace(new_check, '\(select\s+\(select\s+auth\.role\(\)\)\s*\)', '(select auth.role())', 'gi');

    if new_using is distinct from old_using or new_check is distinct from old_check then
      sql_stmt := format('alter policy %I on %I.%I', r.polname, r.schema_name, r.table_name);

      if r.using_expr is not null then
        sql_stmt := sql_stmt || format(' using (%s)', new_using);
      end if;

      if r.check_expr is not null then
        sql_stmt := sql_stmt || format(' with check (%s)', new_check);
      end if;

      execute sql_stmt;
    end if;
  end loop;
end;
$$;

alter policy "All can read companies" on public.companies to authenticated using (true);
