begin;

create or replace function public.get_order_filter_facet_counts(
  p_scope text default 'all'
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
  with base as materialized (
    select
      o.id,
      o.status,
      o.work_type_id,
      o.client_id,
      o.object_id,
      o.company_id,
      o.assigned_to
    from public.orders_accessible o
    where lower(btrim(coalesce(p_scope, 'all'))) in ('all', 'my')
      and (
        lower(btrim(coalesce(p_scope, 'all'))) = 'all'
        or o.assigned_to = auth.uid()
      )
      and coalesce(public.normalize_company_order_status_key(o.status), '') <> 'feed'
  ),
  status_rows as (
    select
      public.normalize_company_order_status_key(status) as value,
      count(*)::bigint as item_count
    from base
    where public.normalize_company_order_status_key(status) is not null
    group by 1
  ),
  work_type_rows as (
    select work_type_id::text as value, count(*)::bigint as item_count
    from base
    where work_type_id is not null
    group by work_type_id
  ),
  client_rows as (
    select client_id::text as value, count(*)::bigint as item_count
    from base
    where client_id is not null
    group by client_id
  ),
  object_rows as (
    select object_id::text as value, count(*)::bigint as item_count
    from base
    where object_id is not null
    group by object_id
  ),
  executor_rows as (
    select assigned_to::text as value, count(*)::bigint as item_count
    from base
    where assigned_to is not null
    group by assigned_to
  ),
  client_tag_rows as (
    select lower(btrim(tag.value)) as value, count(distinct base.id)::bigint as item_count
    from base
    join public.client_tag_links link
      on link.client_id = base.client_id
     and link.company_id = base.company_id
    join public.company_tags tag
      on tag.id = link.tag_id
     and tag.company_id = base.company_id
     and tag.tag_type = 'client'
    where btrim(tag.value) <> ''
    group by lower(btrim(tag.value))
  ),
  object_tag_rows as (
    select lower(btrim(tag.value)) as value, count(distinct base.id)::bigint as item_count
    from base
    join public.object_tag_links link
      on link.object_id = base.object_id
     and link.company_id = base.company_id
    join public.company_tags tag
      on tag.id = link.tag_id
     and tag.company_id = base.company_id
     and tag.tag_type = 'object'
    where btrim(tag.value) <> ''
    group by lower(btrim(tag.value))
  )
  select jsonb_build_object(
    'version', 3,
    'total', (select count(*)::bigint from base),
    'statuses', coalesce(
      (select jsonb_object_agg(value, item_count) from status_rows),
      '{}'::jsonb
    ),
    'workTypes', coalesce(
      (select jsonb_object_agg(value, item_count) from work_type_rows),
      '{}'::jsonb
    ),
    'clients', coalesce(
      (select jsonb_object_agg(value, item_count) from client_rows),
      '{}'::jsonb
    ),
    'objects', coalesce(
      (select jsonb_object_agg(value, item_count) from object_rows),
      '{}'::jsonb
    ),
    'executors', coalesce(
      (select jsonb_object_agg(value, item_count) from executor_rows),
      '{}'::jsonb
    ),
    'clientTags', coalesce(
      (select jsonb_object_agg(value, item_count) from client_tag_rows),
      '{}'::jsonb
    ),
    'objectTags', coalesce(
      (select jsonb_object_agg(value, item_count) from object_tag_rows),
      '{}'::jsonb
    )
  );
$function$;

revoke all on function public.get_order_filter_facet_counts(text) from public, anon;
grant execute on function public.get_order_filter_facet_counts(text) to authenticated, service_role;

comment on function public.get_order_filter_facet_counts(text) is
  'Returns exact v3 non-feed order filter facets including client objects and direct tag relations.';

notify pgrst, 'reload schema';

commit;
