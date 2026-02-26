\x on
select public.enqueue_stale_feed_reminders('1 minute'::interval) as inserted_now;

select event_type, status, count(*)
from public.notification_events
where event_type='feed_stale_reminder'
group by 1,2
order by 2;

select id, event_type, status, created_at, recipient_user_id, order_id
from public.notification_events
where event_type='feed_stale_reminder'
order by id desc
limit 20;
