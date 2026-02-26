select relname, relrowsecurity, relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and relname in ('push_tokens','notification_prefs');

select polname, tablename, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname='public' and tablename in ('push_tokens','notification_prefs')
order by tablename, polname;
