select
  count(*) as feed_unassigned_total,
  count(*) filter (where created_by_user_id is not null) as feed_with_creator,
  count(*) filter (where created_by_user_id is null) as feed_without_creator
from public.orders
where status = 'В ленте' and assigned_to is null;

select id, status, assigned_to, created_by_user_id, feed_entered_at, created_at, updated_at
from public.orders
where status = 'В ленте' and assigned_to is null
order by updated_at desc
limit 20;
