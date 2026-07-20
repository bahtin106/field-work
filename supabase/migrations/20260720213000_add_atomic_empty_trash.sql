begin;

create or replace function public.purge_all_trash_items()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  if not public.current_user_has_trash_permission('canPurgeTrash') then
    raise exception 'Trash purge denied' using errcode = '42501';
  end if;

  for v_id in
    select t.id
    from public.trash_entries t
    where t.is_root
      and t.company_id = public.user_company_id()
      and auth.uid() = any(t.access_user_ids)
    order by case when t.entity_type = 'media' then 0 else 1 end, t.deleted_at, t.id
  loop
    perform public.purge_trash_item(v_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.purge_all_trash_items() from public, anon;
grant execute on function public.purge_all_trash_items() to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
