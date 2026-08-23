begin;

-- Audit rows keep the deleted entity identity in entity_type/entity_id and
-- before_data. Their typed UUID columns are strict foreign keys, so an AFTER
-- DELETE trigger must not point those columns at rows that no longer exist.
-- Patch the deployed function in place to preserve every unrelated audit rule.
do $migration$
declare
  v_signature constant regprocedure := 'public.entity_audit_capture()'::regprocedure;
  v_definition text;
  v_anchor constant text :=
    '  v_company_finance_rule_id := case when tg_table_name = ''company_finance_rules'' then v_entity_uuid else null end;';
  v_guard_marker constant text := 'DELETE audit rows retain identity outside strict foreign-key columns.';
  v_occurrences integer;
begin
  select pg_catalog.pg_get_functiondef(v_signature::oid)
    into strict v_definition;

  if pg_catalog.strpos(v_definition, v_guard_marker) <> 0 then
    return;
  end if;

  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
  ) / pg_catalog.length(v_anchor);

  if v_occurrences <> 1 then
    raise exception 'Cannot safely patch entity_audit_capture DELETE foreign keys';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    v_anchor,
    v_anchor || E'\n\n'
      || '  -- DELETE audit rows retain identity outside strict foreign-key columns.' || E'\n'
      || '  -- Cascading deletes can also remove a related parent before this trigger runs.' || E'\n'
      || '  if v_action = ''delete'' then' || E'\n'
      || '    if v_order_id is not null' || E'\n'
      || '       and not exists (select 1 from public.orders row_ref where row_ref.id = v_order_id) then' || E'\n'
      || '      v_order_id := null;' || E'\n'
      || '    end if;' || E'\n'
      || '    if v_client_id is not null' || E'\n'
      || '       and not exists (select 1 from public.clients row_ref where row_ref.id = v_client_id) then' || E'\n'
      || '      v_client_id := null;' || E'\n'
      || '    end if;' || E'\n'
      || '    if v_client_object_id is not null' || E'\n'
      || '       and not exists (select 1 from public.client_objects row_ref where row_ref.id = v_client_object_id) then' || E'\n'
      || '      v_client_object_id := null;' || E'\n'
      || '    end if;' || E'\n'
      || '    if v_order_finance_entry_id is not null' || E'\n'
      || '       and not exists (select 1 from public.order_finance_entries row_ref where row_ref.id = v_order_finance_entry_id) then' || E'\n'
      || '      v_order_finance_entry_id := null;' || E'\n'
      || '    end if;' || E'\n'
      || '    if v_company_finance_rule_id is not null' || E'\n'
      || '       and not exists (select 1 from public.company_finance_rules row_ref where row_ref.id = v_company_finance_rule_id) then' || E'\n'
      || '      v_company_finance_rule_id := null;' || E'\n'
      || '    end if;' || E'\n'
      || '  end if;'
  );

  execute v_definition;
end;
$migration$;

comment on function public.entity_audit_capture() is
  'Captures entity history; DELETE events retain identity without dangling strict foreign-key references.';

notify pgrst, 'reload schema';

commit;
