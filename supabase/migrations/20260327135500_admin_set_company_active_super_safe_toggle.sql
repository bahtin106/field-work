begin;

create or replace function public.admin_set_company_active_super(
  p_company_id uuid,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_is_active boolean;
begin
  perform public.admin_assert_super_admin();

  update public.companies c
  set is_active = coalesce(p_is_active, c.is_active)
  where c.id = p_company_id
  returning c.is_active into v_effective_is_active;

  if not found then
    raise exception 'company not found: %', p_company_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'is_active', v_effective_is_active
  );
end;
$$;

grant execute on function public.admin_set_company_active_super(uuid, boolean) to authenticated;

commit;
