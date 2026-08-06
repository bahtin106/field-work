begin;

-- Keep the permission-aware history implementation as the core query and add
-- only the address snapshots needed to present an object change as one
-- semantic action. Raw audit snapshots remain private.
do $migration$
begin
  if to_regprocedure(
    'public.get_order_activity_core_v2(uuid,integer,timestamp with time zone,uuid)'
  ) is null then
    execute 'alter function public.get_order_activity(uuid, integer, timestamp with time zone, uuid) rename to get_order_activity_core_v2';
  end if;
end;
$migration$;

revoke all on function public.get_order_activity_core_v2(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_order_activity(
  p_order_id uuid,
  p_limit integer default 30,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  event_id uuid,
  occurred_at timestamptz,
  action text,
  entity_type text,
  actor_user_id uuid,
  actor_name text,
  changes jsonb,
  context jsonb
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth'
as $function$
  select
    activity.event_id,
    activity.occurred_at,
    activity.action,
    activity.entity_type,
    activity.actor_user_id,
    activity.actor_name,
    case
      when activity.entity_type = 'orders'
       and activity.action = 'update'
       and exists (
         select 1
         from jsonb_array_elements(coalesce(activity.changes, '[]'::jsonb)) changed(value)
         where changed.value->>'field' in ('client_id', 'object_id')
       ) then coalesce((
         select jsonb_agg(changed.value order by changed.ordinality)
         from jsonb_array_elements(coalesce(activity.changes, '[]'::jsonb))
           with ordinality changed(value, ordinality)
         where changed.value->>'field' not in (
           'phone', 'address_mode', 'country', 'region', 'district', 'city',
           'street', 'house', 'postal_code', 'floor', 'entrance', 'apartment',
           'entrance_info', 'parking_notes', 'geo_lat', 'geo_lng'
         )
       ), '[]'::jsonb)
      else activity.changes
    end as changes,
    activity.context || case
      when activity.entity_type = 'orders' then jsonb_strip_nulls(jsonb_build_object(
        'before_address', nullif(jsonb_strip_nulls(jsonb_build_object(
          'country', nullif(audit.before_data->>'country', ''),
          'region', nullif(audit.before_data->>'region', ''),
          'district', nullif(audit.before_data->>'district', ''),
          'city', nullif(audit.before_data->>'city', ''),
          'street', nullif(audit.before_data->>'street', ''),
          'house', nullif(audit.before_data->>'house', ''),
          'postal_code', nullif(audit.before_data->>'postal_code', ''),
          'floor', nullif(audit.before_data->>'floor', ''),
          'entrance', nullif(audit.before_data->>'entrance', ''),
          'apartment', nullif(audit.before_data->>'apartment', '')
        )), '{}'::jsonb),
        'after_address', nullif(jsonb_strip_nulls(jsonb_build_object(
          'country', nullif(audit.after_data->>'country', ''),
          'region', nullif(audit.after_data->>'region', ''),
          'district', nullif(audit.after_data->>'district', ''),
          'city', nullif(audit.after_data->>'city', ''),
          'street', nullif(audit.after_data->>'street', ''),
          'house', nullif(audit.after_data->>'house', ''),
          'postal_code', nullif(audit.after_data->>'postal_code', ''),
          'floor', nullif(audit.after_data->>'floor', ''),
          'entrance', nullif(audit.after_data->>'entrance', ''),
          'apartment', nullif(audit.after_data->>'apartment', '')
        )), '{}'::jsonb)
      ))
      else '{}'::jsonb
    end as context
  from public.get_order_activity_core_v2(
    p_order_id,
    p_limit,
    p_before_created_at,
    p_before_id
  ) activity
  left join public.app_entity_audit_log audit
    on audit.id = activity.event_id
  order by activity.occurred_at desc, activity.event_id desc;
$function$;

revoke all on function public.get_order_activity(uuid, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.get_order_activity(uuid, integer, timestamptz, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
