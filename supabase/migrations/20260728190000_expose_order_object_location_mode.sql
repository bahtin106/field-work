begin;

create or replace view public.orders_accessible
with (security_barrier = true)
as
select
  source.*,
  co.location_mode as object_location_mode
from public.orders_accessible_including_trash_v1 source
left join public.client_objects co
  on co.id = source.object_id
 and co.company_id = source.company_id
where not exists (
  select 1
  from public.trash_entries t
  where t.entity_type = 'order'
    and t.entity_id = source.id
);

grant select on public.orders_accessible to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
