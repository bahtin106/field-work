select n.nspname as schema, p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_userbyid(p.proowner) as owner
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='register_push_token';

select grantee, privilege_type
from information_schema.routine_privileges
where specific_schema='public' and routine_name='register_push_token'
order by grantee, privilege_type;

select tablename, tableowner
from pg_tables
where schemaname='public' and tablename in ('push_tokens','notification_prefs');

select grantee, table_name, privilege_type
from information_schema.table_privileges
where table_schema='public' and table_name in ('push_tokens','notification_prefs')
order by table_name, grantee, privilege_type;
