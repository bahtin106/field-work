begin;

create or replace function public.company_order_statuses_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_has_orders boolean;
begin
  if old.is_feed
     and coalesce(current_setting('app.company_deletion_in_progress', true), '') <> '1' then
    raise exception 'feed_status_is_immutable' using errcode = '23514';
  end if;

  select exists (
    select 1
      from public.orders o
     where o.company_id = old.company_id
       and o.status = old.status_key
     for update
  )
    into v_has_orders;

  if v_has_orders
     and coalesce(current_setting('app.order_statuses_delete_in_progress', true), '') <> '1' then
    raise exception 'company_order_status_replacement_required' using errcode = '23514';
  end if;

  return old;
end;
$$;

commit;
