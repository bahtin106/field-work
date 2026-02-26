\x on
select now() as now_utc;

select id, enabled, push_send_url, batch_limit, timeout_ms, updated_at
from public.notification_runtime_config
where id = true;

select jobid, jobname, schedule, active
from cron.job
where jobname = 'push-notifications-worker';

select event_type, status, count(*)
from public.notification_events
group by 1,2
order by 1,2;

select id, event_type, status, created_at, available_at, sent_at, left(coalesce(last_error,''),120) as last_error
from public.notification_events
order by id desc
limit 30;

select id, status, assigned_to, created_at, updated_at
from public.orders
where status = 'В ленте'
order by updated_at desc
limit 20;
