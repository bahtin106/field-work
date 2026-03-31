begin;

-- 1) Make company FK action explicit and consistent with NOT NULL company_id.
alter table public.orders
  drop constraint if exists orders_company_id_fkey;

alter table public.orders
  add constraint orders_company_id_fkey
  foreign key (company_id)
  references public.companies(id)
  on delete restrict;

-- 2) Backfill creator/source where we can infer safely.
with first_actor as (
  select distinct on (l.entity_id)
    l.entity_id::uuid as order_id,
    l.actor_user_id
  from public.app_entity_audit_log l
  where l.entity_type = 'orders'
    and l.action = 'insert'
    and l.actor_user_id is not null
    and l.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  order by l.entity_id, l.created_at asc
)
update public.orders o
set created_by_user_id = fa.actor_user_id
from first_actor fa
where o.id = fa.order_id
  and o.created_by_user_id is null;

update public.orders
set created_by_user_id = assigned_to
where created_by_user_id is null
  and assigned_to is not null;

update public.orders
set creation_source = 'app'
where creation_source is null
   or btrim(creation_source) = '';

-- 3) Guardrails for future writes.
alter table public.orders
  alter column creation_source set default 'app';

alter table public.orders
  drop constraint if exists orders_creation_source_check;

alter table public.orders
  add constraint orders_creation_source_check
  check (creation_source in ('app', 'telegram', 'api', 'import', 'system'));

create or replace function public.orders_sync_creator_and_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), current_user_id(), new.assigned_to, old.assigned_to);
begin
  if tg_op = 'INSERT' then
    new.created_by_user_id := coalesce(new.created_by_user_id, v_actor);
    new.creation_source := coalesce(nullif(btrim(coalesce(new.creation_source, '')), ''), 'app');
  else
    new.created_by_user_id := coalesce(new.created_by_user_id, old.created_by_user_id, v_actor);
    new.creation_source := coalesce(
      nullif(btrim(coalesce(new.creation_source, '')), ''),
      old.creation_source,
      'app'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_sync_creator_and_source on public.orders;
create trigger trg_orders_sync_creator_and_source
before insert or update of created_by_user_id, assigned_to, creation_source
on public.orders
for each row
execute function public.orders_sync_creator_and_source();

commit;
