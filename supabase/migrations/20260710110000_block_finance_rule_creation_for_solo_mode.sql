begin;

-- A solo administrator can keep using rules created in company mode, but cannot
-- create a new company-wide rule. The mode is read from auth.users instead of
-- the JWT so a recently switched account cannot bypass the check with a stale token.
create or replace function public.guard_company_finance_rule_insert()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor_id uuid := auth.uid();
  v_account_type text;
begin
  -- Trusted backend and maintenance jobs have no end-user identity. Client writes
  -- always carry auth.uid() and are additionally constrained by the table RLS policy.
  if v_actor_id is null then
    return new;
  end if;

  select lower(coalesce(nullif(u.raw_user_meta_data ->> 'account_type', ''), 'company'))
    into v_account_type
    from auth.users u
   where u.id = v_actor_id;

  if coalesce(v_account_type, 'company') = 'solo' then
    raise exception using
      errcode = '42501',
      message = 'finance_rules_company_mode_required';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_company_finance_rules_company_mode_insert on public.company_finance_rules;
create trigger trg_company_finance_rules_company_mode_insert
before insert on public.company_finance_rules
for each row
execute function public.guard_company_finance_rule_insert();

revoke all on function public.guard_company_finance_rule_insert() from public, anon, authenticated;

commit;
