set search_path = public;

do $$
declare
  v_schema text;
  v_table text;
  v_name text;
begin
  for v_schema, v_table in
    select split_part(fqtn, '.', 1), split_part(fqtn, '.', 2)
    from (values
      ('public.app_entity_audit_log_default'),
      ('public.app_entity_audit_log_p202603'),
      ('public.app_entity_audit_log_p202604'),
      ('public.app_entity_audit_log_p202605'),
      ('public.app_entity_audit_log_p202606'),
      ('public.company_integration_oauth_states'),
      ('public.company_messenger_field_settings'),
      ('public.company_yandex_disk_connections'),
      ('public.finance_entry_media_external_map'),
      ('public.media_cleanup_queue'),
      ('public.messenger_conversations'),
      ('public.messenger_conversations_archive')
    ) as t(fqtn)
  loop
    if not exists (
      select 1
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = v_schema
        and c.relname = v_table
        and p.polname = 'service_role_all'
    ) then
      execute format(
        'create policy %I on %I.%I as permissive for all to service_role using (true) with check (true)',
        'service_role_all',
        v_schema,
        v_table
      );
    end if;
  end loop;
end;
$$;
