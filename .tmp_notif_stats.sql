select count(*) as prefs_total,
       count(*) filter (where allow=false) as prefs_allow_false,
       count(*) filter (where allow=true) as prefs_allow_true
from public.notification_prefs;
