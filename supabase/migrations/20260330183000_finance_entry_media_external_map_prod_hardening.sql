set search_path = public;

-- Normalize legacy rows to match current finance entry ownership.
update public.finance_entry_media_external_map m
set
  company_id = e.company_id,
  order_id = e.order_id
from public.order_finance_entries e
where e.id = m.finance_entry_id
  and (
    m.company_id is distinct from e.company_id
    or m.order_id is distinct from e.order_id
  );

-- Deduplicate by stable storage path inside one finance entry.
with ranked as (
  select
    id,
    row_number() over (
      partition by finance_entry_id, external_path
      order by created_at desc, id desc
    ) as rn
  from public.finance_entry_media_external_map
)
delete from public.finance_entry_media_external_map m
using ranked r
where r.id = m.id
  and r.rn > 1;

create unique index if not exists finance_entry_media_external_map_entry_external_path_uidx
  on public.finance_entry_media_external_map (finance_entry_id, external_path);

create index if not exists idx_finance_entry_media_external_map_company_created
  on public.finance_entry_media_external_map (company_id, created_at desc);

create or replace function public.finance_entry_media_external_map_validate_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_order_id uuid;
begin
  select e.company_id, e.order_id
    into v_company_id, v_order_id
    from public.order_finance_entries e
   where e.id = new.finance_entry_id;

  if not found then
    raise exception 'Finance entry % not found', new.finance_entry_id;
  end if;

  if new.company_id is distinct from v_company_id then
    raise exception 'Invalid company_id for finance_entry_id %', new.finance_entry_id;
  end if;

  if new.order_id is distinct from v_order_id then
    raise exception 'Invalid order_id for finance_entry_id %', new.finance_entry_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_finance_entry_media_external_map_validate_refs on public.finance_entry_media_external_map;
create trigger trg_finance_entry_media_external_map_validate_refs
before insert or update of company_id, order_id, finance_entry_id
on public.finance_entry_media_external_map
for each row
execute function public.finance_entry_media_external_map_validate_refs();

