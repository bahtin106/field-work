begin;

create or replace function public.orders_sync_completed_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_done_status constant text := U&'\0417\0430\0432\0435\0440\0448\0451\043d\043d\0430\044f';
begin
  if tg_op = 'INSERT' then
    if new.status = v_done_status then
      new.completed_at := coalesce(new.completed_at, now());
    else
      new.completed_at := null;
    end if;
    return new;
  end if;

  if new.status = v_done_status then
    new.completed_at := coalesce(new.completed_at, old.completed_at, now());
  else
    new.completed_at := null;
  end if;

  return new;
end
$$;

update public.orders
set completed_at = coalesce(completed_at, updated_at, created_at, now())
where status = U&'\0417\0430\0432\0435\0440\0448\0451\043d\043d\0430\044f'
  and completed_at is null;

update public.orders
set completed_at = null
where status <> U&'\0417\0430\0432\0435\0440\0448\0451\043d\043d\0430\044f'
  and completed_at is not null;

commit;

