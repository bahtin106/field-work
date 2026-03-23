begin;

with amount_permissions as (
  select
    p.company_id,
    p.role,
    max(
      case
        when p.key = 'canViewOrderAmount' then
          case
            when lower(trim(coalesce(p.value::text, ''))) in ('true', 't', '1', 'yes', 'y') then 1
            else 0
          end
        else null
      end
    ) as view_amount_bit,
    max(
      case
        when p.key = 'canEditOrderAmount' then
          case
            when lower(trim(coalesce(p.value::text, ''))) in ('true', 't', '1', 'yes', 'y') then 1
            else 0
          end
        else null
      end
    ) as edit_amount_bit
  from public.app_role_permissions p
  where p.key in ('canViewOrderAmount', 'canEditOrderAmount')
  group by p.company_id, p.role
),
mapped as (
  select
    company_id,
    role,
    coalesce(view_amount_bit, 0) = 1 as can_view_finance_in_orders,
    (
      case
        when coalesce(edit_amount_bit, 0) = 1 then true
        else false
      end
    ) as can_edit_finance_in_orders
  from amount_permissions
),
upsert_target as (
  select company_id, role, 'canViewFinanceAll'::text as key, can_view_finance_in_orders as value from mapped
  union all
  select company_id, role, 'canViewFinanceOwn'::text as key, can_view_finance_in_orders as value from mapped
  union all
  select company_id, role, 'canEditFinanceEntries'::text as key, can_edit_finance_in_orders as value from mapped
)
insert into public.app_role_permissions (company_id, role, key, value)
select company_id, role, key, value
from upsert_target
on conflict (company_id, role, key)
do update set value = excluded.value;

with current_matrix as (
  select
    p.company_id,
    p.role,
    max(
      case
        when p.key = 'canViewFinanceAll'
          and lower(trim(coalesce(p.value::text, ''))) in ('true', 't', '1', 'yes', 'y')
        then 1
        else 0
      end
    ) = 1 as can_view_finance_all,
    max(
      case
        when p.key = 'canEditFinanceEntries'
          and lower(trim(coalesce(p.value::text, ''))) in ('true', 't', '1', 'yes', 'y')
        then 1
        else 0
      end
    ) = 1 as can_edit_finance_entries
  from public.app_role_permissions p
  where p.key in ('canViewFinanceAll', 'canEditFinanceEntries')
  group by p.company_id, p.role
),
normalized as (
  select
    company_id,
    role,
    case when can_edit_finance_entries then true else can_view_finance_all end as next_can_view_finance_all,
    can_edit_finance_entries as next_can_edit_finance_entries
  from current_matrix
)
update public.app_role_permissions p
set value = case
  when p.key = 'canViewFinanceAll' then n.next_can_view_finance_all
  when p.key = 'canViewFinanceOwn' then n.next_can_view_finance_all
  when p.key = 'canEditFinanceEntries' then n.next_can_edit_finance_entries
  else p.value
end
from normalized n
where p.company_id = n.company_id
  and p.role = n.role
  and p.key in ('canViewFinanceAll', 'canViewFinanceOwn', 'canEditFinanceEntries');

commit;
