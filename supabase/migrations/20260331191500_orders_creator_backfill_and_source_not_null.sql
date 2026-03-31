begin;

-- Backfill missing creators from earliest known actor in audit log.
with first_actor as (
  select distinct on (l.entity_id)
    l.entity_id::uuid as order_id,
    l.actor_user_id
  from public.app_entity_audit_log l
  where l.entity_type = 'orders'
    and l.actor_user_id is not null
    and l.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  order by l.entity_id, l.created_at asc
)
update public.orders o
set created_by_user_id = fa.actor_user_id
from first_actor fa
where o.id = fa.order_id
  and o.created_by_user_id is null;

-- Enforce source presence for future rows (value domain already guarded by check).
update public.orders
set creation_source = 'app'
where creation_source is null
   or btrim(creation_source) = '';

alter table public.orders
  alter column creation_source set not null;

commit;
