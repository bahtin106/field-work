begin;

alter table public.orders
  drop constraint if exists orders_client_id_fkey;

alter table public.orders
  add constraint orders_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete restrict;

alter table public.orders
  drop constraint if exists orders_object_id_fkey;

alter table public.orders
  add constraint orders_object_id_fkey
  foreign key (object_id) references public.client_objects(id) on delete restrict;

drop trigger if exists trg_orders_validate_object_link on public.orders;

create or replace function public.orders_validate_object_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object public.client_objects%rowtype;
begin
  if new.object_id is null then
    return new;
  end if;

  select *
    into v_object
    from public.client_objects
   where id = new.object_id;

  if v_object.id is null then
    raise exception 'client object % not found', new.object_id
      using errcode = '23503';
  end if;

  if new.company_id is distinct from v_object.company_id then
    raise exception 'client object % does not belong to company %', new.object_id, new.company_id
      using errcode = '42501';
  end if;

  if new.client_id is not null and new.client_id is distinct from v_object.client_id then
    raise exception 'client object % does not belong to client %', new.object_id, new.client_id
      using errcode = '42501';
  end if;

  new.client_id := v_object.client_id;
  return new;
end;
$$;

create trigger trg_orders_validate_object_link
before insert or update of company_id, client_id, object_id
on public.orders
for each row
execute function public.orders_validate_object_link();

create or replace function public.get_client_delete_blockers(p_client_id uuid)
returns table(
  client_id uuid,
  blocking_orders_count integer,
  blocking_objects_count integer,
  blocking_object_ids uuid[],
  my_orders_count integer,
  feed_orders_count integer,
  other_orders_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_object_ids uuid[];
begin
  if p_client_id is null then
    raise exception 'client_id is required' using errcode = '23502';
  end if;

  select c.company_id
    into v_company_id
    from public.clients c
   where c.id = p_client_id;

  if v_company_id is null then
    raise exception 'client % not found', p_client_id using errcode = '23503';
  end if;

  if v_company_id <> user_company_id() then
    raise exception 'client % does not belong to current company', p_client_id using errcode = '42501';
  end if;

  if not has_app_role_permission(
    v_company_id,
    user_role(),
    'canDeleteClients',
    clients_permission_default(user_role(), 'canDeleteClients')
  ) then
    raise exception 'deleting clients is not allowed' using errcode = '42501';
  end if;

  select coalesce(array_agg(o.id order by o.created_at, o.id), '{}'::uuid[])
    into v_object_ids
    from public.client_objects o
   where o.client_id = p_client_id;

  return query
  with matched as (
    select distinct o.id, o.assigned_to, o.object_id
      from public.orders o
     where o.company_id = v_company_id
       and (
         o.client_id = p_client_id
         or (
           coalesce(array_length(v_object_ids, 1), 0) > 0
           and o.object_id = any(v_object_ids)
         )
       )
  ),
  matched_objects as (
    select coalesce(array_agg(distinct m.object_id) filter (where m.object_id is not null), '{}'::uuid[]) as ids
      from matched m
  )
  select
    p_client_id,
    count(m.id)::integer,
    coalesce(array_length(mo.ids, 1), 0)::integer,
    mo.ids,
    count(*) filter (where m.assigned_to = auth.uid())::integer,
    count(*) filter (where m.assigned_to is null)::integer,
    count(*) filter (where m.assigned_to is not null and m.assigned_to <> auth.uid())::integer
  from matched m
  cross join matched_objects mo;
end;
$$;

grant execute on function public.get_client_delete_blockers(uuid) to authenticated;

comment on function public.get_client_delete_blockers(uuid) is
  'Returns blocking order counts for a client deletion flow, including orders linked through client_id or client objects.';

commit;
