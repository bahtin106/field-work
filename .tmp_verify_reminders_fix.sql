\x on
select pg_get_functiondef('public.enqueue_stale_feed_reminders(interval)'::regprocedure) as fn_def;

select id, status, assigned_to, created_at, updated_at, feed_entered_at
from public.orders
where status = 'В ленте'
order by updated_at desc
limit 10;

select public.enqueue_stale_feed_reminders('1 minute'::interval) as inserted_now;

select id, event_type, status, created_at, recipient_user_id, order_id
from public.notification_events
where event_type = 'feed_stale_reminder'
order by id desc
limit 20;
