-- Drop legacy app_enabled_fields table.
-- Keep backward compatibility for get_enabled_order_fields(), but without legacy view.

begin;

drop function if exists public.get_enabled_order_fields(uuid);

create function public.get_enabled_order_fields(p_company_id uuid)
returns table (
  company_id uuid,
  field_key public.order_field_key,
  is_enabled_create boolean,
  is_enabled_edit boolean,
  is_visible_read boolean
)
language sql
stable
set search_path to 'pg_catalog', 'public'
as $function$
  select
    s.company_id,
    (s.field_key)::public.order_field_key as field_key,
    coalesce(s.is_enabled, false) as is_enabled_create,
    coalesce(s.is_enabled, false) as is_enabled_edit,
    coalesce(s.is_enabled, false) as is_visible_read
  from public.company_entity_field_settings s
  where s.entity_type = 'order'
    and s.company_id = p_company_id
    and s.field_key in (
      select e.enumlabel
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.typname = 'order_field_key'
    )
$function$;

do $$
begin
  if to_regclass('public.app_enabled_fields') is not null then
    execute 'drop policy if exists app_enabled_fields_read on public.app_enabled_fields';
    execute 'drop table if exists public.app_enabled_fields';
  end if;
end
$$;

drop view if exists public.app_enabled_order_fields_v;

commit;
