create or replace function public.get_order_executor_display_names(p_user_ids uuid[])
returns table(id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select p.company_id
    from public.profiles p
    where p.id = auth.uid()
    limit 1
  )
  select
    p.id,
    coalesce(
      nullif(
        btrim(
          concat_ws(
            ' ',
            nullif(btrim(coalesce(p.first_name, '')), ''),
            nullif(btrim(coalesce(p.middle_name, '')), ''),
            nullif(btrim(coalesce(p.last_name, '')), '')
          )
        ),
        ''
      ),
      nullif(btrim(coalesce(p.full_name, '')), ''),
      nullif(btrim(coalesce(p.email, '')), '')
    ) as display_name
  from public.profiles p
  join caller c on true
  where auth.uid() is not null
    and p.id = any(coalesce(p_user_ids, array[]::uuid[]))
    and (
      p.id = auth.uid()
      or (
        p.company_id is not null
        and c.company_id is not null
        and p.company_id = c.company_id
      )
    )
    and coalesce(
      nullif(btrim(concat_ws(' ', p.first_name, p.middle_name, p.last_name)), ''),
      nullif(btrim(coalesce(p.full_name, '')), ''),
      nullif(btrim(coalesce(p.email, '')), '')
    ) is not null;
$$;

revoke all on function public.get_order_executor_display_names(uuid[]) from public;
grant execute on function public.get_order_executor_display_names(uuid[]) to authenticated;
