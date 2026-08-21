\set ON_ERROR_STOP on

-- Run after 20260821020000_skip_trashed_orders_in_finance_recalculation.sql.
-- The test verifies the deployed RPC definitions without changing data.
begin;

do $test$
declare
  v_signatures regprocedure[] := array[
    'public.upsert_company_finance_scheme_v2(jsonb)'::regprocedure,
    'public.archive_company_finance_scheme_v2(uuid,boolean)'::regprocedure,
    'public.set_company_finance_scheme_enabled_v2(uuid,boolean,boolean)'::regprocedure
  ];
  v_signature regprocedure;
  v_definition text;
begin
  foreach v_signature in array v_signatures
  loop
    select pg_catalog.pg_get_functiondef(v_signature::oid)
      into strict v_definition;

    if pg_catalog.strpos(
      v_definition,
      'from public.trash_entries trash_entry'
    ) = 0
       or pg_catalog.strpos(
         v_definition,
         'and trash_entry.entity_id = o.id'
       ) = 0 then
      raise exception '% does not exclude trashed requests', v_signature;
    end if;
  end loop;
end;
$test$;

rollback;
