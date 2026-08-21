begin;

-- Trashed requests are immutable. Finance-scheme RPCs recalculate every
-- unlocked request after a scheme is saved, archived, enabled or disabled.
-- Exclude requests that are already represented in trash_entries so a single
-- deleted request cannot abort the whole settings transaction.
--
-- Patch only the shared selection predicate in the three existing RPCs. Using
-- their deployed definitions keeps the rest of the finance engine byte-for-
-- byte unchanged and makes the migration fail closed if that predicate ever
-- changes shape.
do $migration$
declare
  v_signatures regprocedure[] := array[
    'public.upsert_company_finance_scheme_v2(jsonb)'::regprocedure,
    'public.archive_company_finance_scheme_v2(uuid,boolean)'::regprocedure,
    'public.set_company_finance_scheme_enabled_v2(uuid,boolean,boolean)'::regprocedure
  ];
  v_signature regprocedure;
  v_definition text;
  v_open_filter constant text := 'and snap.locked_at is null';
  v_trash_marker constant text := 'and trash_entry.entity_id = o.id';
  v_occurrences integer;
begin
  foreach v_signature in array v_signatures
  loop
    select pg_catalog.pg_get_functiondef(v_signature::oid)
      into strict v_definition;

    -- Keep the migration safe to inspect or re-run after a transactional
    -- deployment retry without stacking the same predicate twice.
    if pg_catalog.strpos(v_definition, v_trash_marker) <> 0 then
      continue;
    end if;

    v_occurrences := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_open_filter, ''))
    ) / pg_catalog.length(v_open_filter);

    if v_occurrences <> 1
       or pg_catalog.strpos(v_definition, 'from public.orders o') = 0 then
      raise exception
        'Cannot safely patch finance recalculation selector in %',
        v_signature;
    end if;

    v_definition := pg_catalog.replace(
      v_definition,
      v_open_filter,
      v_open_filter || E'\n'
        || '         and not exists (' || E'\n'
        || '           select 1' || E'\n'
        || '             from public.trash_entries trash_entry' || E'\n'
        || '            where trash_entry.entity_type = ''order''' || E'\n'
        || '              and trash_entry.entity_id = o.id' || E'\n'
        || '         )'
    );

    execute v_definition;
  end loop;
end;
$migration$;

commit;
