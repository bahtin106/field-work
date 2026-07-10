begin;

create or replace function public.normalize_company_order_status_key(p_status text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_value text := lower(btrim(coalesce(p_status, '')));
begin
  if v_value = '' then
    return null;
  end if;

  if v_value in ('feed', 'in_feed', U&'\0432 \043B\0435\043D\0442\0435', U&'\043B\0435\043D\0442\0430') then
    return 'feed';
  end if;
  if v_value in ('new', U&'\043D\043E\0432\044B\0439', U&'\043D\043E\0432\0430\044F') then
    return 'new';
  end if;
  if v_value in ('in_progress', 'progress', 'in progress', U&'\0432 \0440\0430\0431\043E\0442\0435') then
    return 'in_progress';
  end if;
  if v_value in (
    'done',
    'completed',
    'complete',
    U&'\0437\0430\0432\0435\0440\0448\0451\043D\043D\0430\044F',
    U&'\0437\0430\0432\0435\0440\0448\0435\043D\043D\0430\044F',
    U&'\0437\0430\0432\0435\0440\0448\0451\043D\043D\044B\0435',
    U&'\0437\0430\0432\0435\0440\0448\0435\043D\043D\044B\0435'
  ) then
    return 'done';
  end if;
  if v_value in ('waiting', 'pending', U&'\0432 \043E\0436\0438\0434\0430\043D\0438\0438') then
    return 'waiting';
  end if;

  return btrim(p_status);
end;
$$;

do $$
begin
  if public.normalize_company_order_status_key(U&'\0412 \0440\0430\0431\043E\0442\0435') <> 'in_progress'
     or public.normalize_company_order_status_key(U&'\041D\043E\0432\044B\0439') <> 'new'
     or public.normalize_company_order_status_key(U&'\0417\0430\0432\0435\0440\0448\0451\043D\043D\0430\044F') <> 'done' then
    raise exception 'order_status_normalization_failed';
  end if;
end;
$$;

with audited_statuses as (
  select distinct on (o.id)
    o.id,
    o.company_id,
    public.normalize_company_order_status_key(a.before_data->>'status') as status_key
  from public.orders o
  join public.companies c on c.id = o.company_id
  join public.app_entity_audit_log a on a.order_id = o.id
  where c.use_order_statuses is true
    and o.status is null
    and c.order_statuses_initialized_at is not null
    and a.entity_type = 'orders'
    and a.created_at = c.order_statuses_initialized_at
    and a.after_data->>'status' is null
    and a.before_data->>'status' is not null
  order by o.id, a.id desc
)
update public.orders o
   set status = restored.status_key
  from audited_statuses restored
 where o.id = restored.id
   and o.status is null
   and restored.status_key is not null
   and exists (
     select 1
       from public.company_order_statuses s
      where s.company_id = restored.company_id
        and s.status_key = restored.status_key
   );

commit;
