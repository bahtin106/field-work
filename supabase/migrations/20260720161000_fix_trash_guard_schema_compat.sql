begin;

create or replace function public.guard_trashed_entity_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_entity_type text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return new;
  end if;
  v_entity_type := case tg_table_name
    when 'orders' then 'order'
    when 'clients' then 'client'
    when 'client_objects' then 'client_object'
    else null
  end;
  if exists (
    select 1 from public.trash_entries t
    where t.entity_type = v_entity_type and t.entity_id = old.id
  ) then
    if v_entity_type = 'order'
       and (to_jsonb(old) - array['work_type_id','department_id','updated_at','updated_by'])
           = (to_jsonb(new) - array['work_type_id','department_id','updated_at','updated_by'])
       and (
         to_jsonb(new) -> 'work_type_id' is not distinct from 'null'::jsonb
         or to_jsonb(new) -> 'work_type_id' is not distinct from to_jsonb(old) -> 'work_type_id'
       )
       and (
         to_jsonb(new) -> 'department_id' is not distinct from 'null'::jsonb
         or to_jsonb(new) -> 'department_id' is not distinct from to_jsonb(old) -> 'department_id'
       ) then
      return new;
    end if;
    raise exception 'Deleted entities are read-only' using errcode = '55000';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
commit;
