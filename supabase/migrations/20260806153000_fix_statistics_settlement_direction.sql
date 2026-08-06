begin;

-- The statistics RPC originally used enum values from an abandoned draft of
-- Finance V2. Patch only the two stale branches while preserving the already
-- deployed function contract and all grants.
do $migration$
declare
  v_function_oid oid;
  v_definition text;
begin
  select procedure.oid
    into v_function_oid
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname = 'get_statistics_dashboard_v2'
     and pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
       'p_from date, p_to date, p_scope text, p_employee_ids uuid[], p_department_ids uuid[], p_include_no_department boolean, p_work_type_ids uuid[], p_include_no_work_type boolean';

  if v_function_oid is null then
    raise exception 'get_statistics_dashboard_v2 contract is missing';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_function_oid);
  v_definition := replace(
    v_definition,
    'when ''company_owes_worker'' then',
    'when ''company_to_executor'' then'
  );
  v_definition := replace(
    v_definition,
    'when ''worker_owes_company'' then',
    'when ''executor_to_company'' then'
  );

  if position('company_owes_worker' in v_definition) > 0
     or position('worker_owes_company' in v_definition) > 0 then
    raise exception 'stale statistics settlement values could not be replaced';
  end if;
  if position('company_to_executor' in v_definition) = 0
     or position('executor_to_company' in v_definition) = 0 then
    raise exception 'current finance settlement values are missing from statistics RPC';
  end if;

  execute v_definition;
end;
$migration$;

commit;
