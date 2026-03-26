-- Ensure client_objects primary consistency:
-- 1) every client with objects has exactly one primary object;
-- 2) if primary object is deleted, another object is promoted automatically.

begin;

-- Backfill: if a client has objects but no primary yet, mark the oldest object as primary.
with ranked as (
  select
    co.id,
    co.client_id,
    row_number() over (partition by co.client_id order by co.created_at asc, co.id asc) as rn
  from public.client_objects co
),
clients_without_primary as (
  select co.client_id
  from public.client_objects co
  group by co.client_id
  having bool_or(co.is_primary) = false
)
update public.client_objects target
set
  is_primary = true,
  updated_at = now(),
  updated_by = auth.uid()
from ranked r
join clients_without_primary cwp on cwp.client_id = r.client_id
where target.id = r.id
  and r.rn = 1;

-- Guardrail: if a primary object is deleted and client still has objects,
-- promote the oldest remaining object to primary.
create or replace function public.client_objects_promote_primary_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_id uuid;
begin
  if old.client_id is null then
    return old;
  end if;

  if old.is_primary then
    select co.id
      into v_next_id
    from public.client_objects co
    where co.client_id = old.client_id
    order by co.created_at asc, co.id asc
    limit 1;

    if v_next_id is not null then
      update public.client_objects
      set
        is_primary = true,
        updated_at = now(),
        updated_by = auth.uid()
      where id = v_next_id;
    end if;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_client_objects_promote_primary_after_delete on public.client_objects;
create trigger trg_client_objects_promote_primary_after_delete
after delete on public.client_objects
for each row execute function public.client_objects_promote_primary_after_delete();

commit;

