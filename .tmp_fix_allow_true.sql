update public.notification_prefs
set allow = true,
    updated_at = now()
where allow = false;

select user_id, allow, updated_at from public.notification_prefs order by updated_at desc;
