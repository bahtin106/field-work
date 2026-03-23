begin;

create or replace function public.delete_company_finance_rule(
  p_rule_id uuid,
  p_delete_existing_entries boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule_company_id uuid;
  v_user_company_id uuid;
begin
  if p_rule_id is null then
    raise exception 'rule_id is required';
  end if;

  select r.company_id
    into v_rule_company_id
    from public.company_finance_rules r
   where r.id = p_rule_id
   for update;

  if not found then
    return;
  end if;

  select p.company_id
    into v_user_company_id
    from public.profiles p
   where p.id = auth.uid();

  if v_user_company_id is null or v_user_company_id <> v_rule_company_id then
    raise exception 'forbidden';
  end if;

  if p_delete_existing_entries then
    delete from public.order_finance_entries e
     where e.rule_id = p_rule_id
       and e.company_id = v_rule_company_id;
  end if;

  delete from public.company_finance_rules r
   where r.id = p_rule_id
     and r.company_id = v_rule_company_id;
end;
$$;

grant execute on function public.delete_company_finance_rule(uuid, boolean) to authenticated, service_role;

commit;
