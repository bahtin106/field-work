select policyname, tablename, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname='public' and tablename in ('push_tokens','notification_prefs')
order by tablename, policyname;
