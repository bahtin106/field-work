-- Prevent selecting disabled work types in new/updated orders.
-- Existing orders with already assigned disabled work type remain valid.

create or replace function public.orders_validate_enabled_work_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_enabled boolean;
begin
  if new.work_type_id is null then
    return new;
  end if;

  -- Keep historical value if work type did not change on update.
  if tg_op = 'UPDATE' and new.work_type_id is not distinct from old.work_type_id then
    return new;
  end if;

  select wt.is_enabled
    into v_is_enabled
    from public.work_types wt
   where wt.id = new.work_type_id
     and wt.company_id = new.company_id
   limit 1;

  if v_is_enabled is null then
    raise exception 'WORK_TYPE_NOT_FOUND_IN_COMPANY'
      using errcode = '23503';
  end if;

  if v_is_enabled = false then
    raise exception 'WORK_TYPE_DISABLED_FOR_SELECTION'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_validate_enabled_work_type on public.orders;
create trigger trg_orders_validate_enabled_work_type
before insert or update of work_type_id, company_id
on public.orders
for each row
execute function public.orders_validate_enabled_work_type();
