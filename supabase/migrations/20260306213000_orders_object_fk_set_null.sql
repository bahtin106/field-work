begin;

drop trigger if exists trg_orders_validate_object_link on public.orders;

alter table public.orders
  drop constraint if exists orders_object_id_fkey;

alter table public.orders
  add constraint orders_object_id_fkey
  foreign key (object_id) references public.client_objects(id) on delete set null;

create or replace function public.orders_validate_object_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object public.client_objects%rowtype;
begin
  -- Allow orders without linked object. Client relation is preserved.
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

commit;
