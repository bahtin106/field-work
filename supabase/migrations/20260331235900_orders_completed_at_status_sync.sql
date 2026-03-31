begin;

create or replace function public.orders_sync_completed_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'Завершённая' then
      new.completed_at := coalesce(new.completed_at, now());
    else
      new.completed_at := null;
    end if;
    return new;
  end if;

  if new.status = 'Завершённая' then
    new.completed_at := coalesce(new.completed_at, old.completed_at, now());
  else
    new.completed_at := null;
  end if;

  return new;
end
$$;

drop trigger if exists trg_orders_sync_completed_at on public.orders;
create trigger trg_orders_sync_completed_at
before insert or update on public.orders
for each row
execute function public.orders_sync_completed_at();

-- Backfill historical rows to keep data consistent.
update public.orders
set completed_at = coalesce(completed_at, updated_at, created_at, now())
where status = 'Завершённая'
  and completed_at is null;

update public.orders
set completed_at = null
where status <> 'Завершённая'
  and completed_at is not null;

commit;

