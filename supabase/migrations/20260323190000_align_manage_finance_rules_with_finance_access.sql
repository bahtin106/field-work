begin;

with access_matrix as (
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
    (can_view_finance_all and can_edit_finance_entries) as can_manage_finance_rules
  from access_matrix
)
insert into public.app_role_permissions (company_id, role, key, value)
select
  company_id,
  role,
  'canManageFinanceRules'::text as key,
  can_manage_finance_rules as value
from normalized
on conflict (company_id, role, key)
do update set value = excluded.value;

commit;
