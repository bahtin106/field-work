begin;

-- 1) Security hardening: backend-owned queue/log table.
revoke all on table public.notification_events from anon;
revoke all on table public.notification_events from authenticated;
grant select, insert, update, delete on table public.notification_events to service_role;

drop policy if exists notification_events_service_role_all on public.notification_events;
create policy notification_events_service_role_all
on public.notification_events
for all
to service_role
using (true)
with check (true);

-- 2) Integrity checks.
alter table public.notification_events
  drop constraint if exists notification_events_attempt_count_nonnegative_check,
  drop constraint if exists notification_events_payload_object_check;

alter table public.notification_events
  add constraint notification_events_attempt_count_nonnegative_check
    check (attempt_count >= 0),
  add constraint notification_events_payload_object_check
    check (jsonb_typeof(payload) = 'object');

-- 3) FK for company navigation (UI arrows) and integrity.
alter table public.notification_events
  drop constraint if exists notification_events_company_id_fkey,
  add constraint notification_events_company_id_fkey
    foreign key (company_id)
    references public.companies(id)
    on delete cascade;

-- 4) Add order FK-friendly column for navigation.
alter table public.notification_events
  add column if not exists order_ref_id uuid null;

-- Backfill only resolvable references (invalid/missing IDs remain null).
update public.notification_events ne
set order_ref_id = o.id
from public.orders o
where ne.order_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and o.id = ne.order_id::uuid;

create index if not exists idx_notification_events_order_ref_id
  on public.notification_events(order_ref_id)
  where order_ref_id is not null;

alter table public.notification_events
  drop constraint if exists notification_events_order_ref_id_fkey,
  add constraint notification_events_order_ref_id_fkey
    foreign key (order_ref_id)
    references public.orders(id)
    on delete set null;

create or replace function public.notification_events_fill_order_ref_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.order_id is null or btrim(new.order_id) = '' then
    new.order_ref_id := null;
    return new;
  end if;

  if new.order_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select o.id into new.order_ref_id
    from public.orders o
    where o.id = new.order_id::uuid;
  else
    new.order_ref_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notification_events_fill_order_ref_id on public.notification_events;
create trigger trg_notification_events_fill_order_ref_id
before insert or update of order_id
on public.notification_events
for each row
execute function public.notification_events_fill_order_ref_id();

-- 5) Reduce notification retention window to 30 days.
do $$
declare
  v_exists boolean;
begin
  -- One-time cleanup now with 30-day notification retention.
  perform public.cleanup_background_tables_retention(30, 365, 90, 30, 200000);

  select exists(select 1 from pg_extension where extname = 'pg_cron') into v_exists;
  if v_exists then
    begin
      perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'background_tables_retention_cleanup';
    exception when others then
      null;
    end;

    perform cron.schedule(
      'background_tables_retention_cleanup',
      '37 3 * * *',
      'select public.cleanup_background_tables_retention(30, 365, 90, 30, 200000);'
    );
  end if;
end
$$;

commit;
