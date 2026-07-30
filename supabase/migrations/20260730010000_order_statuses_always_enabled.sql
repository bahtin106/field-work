begin;

-- Statuses are a permanent part of every company. Initialize only companies
-- that have never had a status configuration; existing custom configurations
-- and feed choices must stay exactly as they are.
select set_config('app.order_statuses_initializing', '1', true);

insert into public.company_order_statuses (
  company_id,
  status_key,
  name,
  is_feed,
  sort_order
)
select
  company.id,
  defaults.status_key,
  defaults.name,
  defaults.is_feed,
  defaults.sort_order
from public.companies company
cross join (
  values
    ('feed'::text, U&'\0412 \043B\0435\043D\0442\0435'::text, true, 0::smallint),
    ('new', U&'\041D\043E\0432\044B\0439', false, 1::smallint),
    ('in_progress', U&'\0412 \0440\0430\0431\043E\0442\0435', false, 2::smallint),
    ('done', U&'\0417\0430\0432\0435\0440\0448\0451\043D\043D\0430\044F', false, 3::smallint),
    ('waiting', U&'\0412 \043E\0436\0438\0434\0430\043D\0438\0438', false, 4::smallint)
) as defaults(status_key, name, is_feed, sort_order)
where company.order_statuses_initialized_at is null
on conflict do nothing;

-- The former update trigger implemented enable/disable transitions. Remove it
-- before fixing existing rows so no request data is rewritten as a side effect.
drop trigger if exists trg_companies_apply_order_status_settings on public.companies;
drop function if exists public.companies_apply_order_status_settings();

update public.companies
set use_order_statuses = true,
    feed_status_enabled = case
      when order_statuses_initialized_at is null then true
      else feed_status_enabled
    end,
    order_statuses_initialized_at = coalesce(order_statuses_initialized_at, now())
where use_order_statuses is distinct from true
   or order_statuses_initialized_at is null;

alter table public.companies
  alter column use_order_statuses set default true;

alter table public.companies
  drop constraint if exists companies_order_statuses_always_enabled_check;
alter table public.companies
  add constraint companies_order_statuses_always_enabled_check
  check (use_order_statuses is true);

comment on column public.companies.use_order_statuses is
  'Compatibility flag fixed to true: request statuses are always enabled.';

create or replace function public.initialize_company_order_statuses_after_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.company_order_statuses (
    company_id,
    status_key,
    name,
    is_feed,
    sort_order
  )
  values
    (new.id, 'feed', U&'\0412 \043B\0435\043D\0442\0435', true, 0),
    (new.id, 'new', U&'\041D\043E\0432\044B\0439', false, 1),
    (new.id, 'in_progress', U&'\0412 \0440\0430\0431\043E\0442\0435', false, 2),
    (new.id, 'done', U&'\0417\0430\0432\0435\0440\0448\0451\043D\043D\0430\044F', false, 3),
    (new.id, 'waiting', U&'\0412 \043E\0436\0438\0434\0430\043D\0438\0438', false, 4)
  on conflict do nothing;

  update public.companies
     set feed_status_enabled = true,
         order_statuses_initialized_at = coalesce(order_statuses_initialized_at, now())
   where id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_initialize_company_order_statuses_after_insert on public.companies;
create trigger trg_initialize_company_order_statuses_after_insert
after insert on public.companies
for each row execute function public.initialize_company_order_statuses_after_insert();

revoke all on function public.initialize_company_order_statuses_after_insert()
  from public, anon, authenticated;

commit;
