begin;

create or replace function public.admin_update_company_super(
  p_company_id uuid,
  p_name text,
  p_timezone text,
  p_currency text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.admin_update_company_super(
    p_company_id,
    p_name,
    p_timezone,
    p_currency,
    null::boolean
  );
$$;

grant execute on function public.admin_update_company_super(uuid, text, text, text) to authenticated;

commit;
