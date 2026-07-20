create or replace function public.get_trash_media_origin(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v public.trash_entries;
  v_owner_type text;
  v_owner_id uuid;
  v_parent_order_id uuid;
  v_title text;
  v_order_title text;
  v_exists boolean := false;
  v_status text := 'missing';
  v_trash_entry_id uuid;
begin
  if not public.current_user_has_trash_permission('canViewTrash') then
    raise exception 'Trash access denied' using errcode = '42501';
  end if;

  select * into v
  from public.trash_entries t
  where t.id = p_id
    and t.is_root
    and t.entity_type = 'media'
    and t.company_id = public.user_company_id()
    and auth.uid() = any(t.access_user_ids);
  if not found then
    raise exception 'Trash media not found' using errcode = 'P0002';
  end if;

  v_owner_type := coalesce(v.record_data ->> 'owner_type', '');
  begin
    v_owner_id := nullif(v.record_data ->> 'owner_id', '')::uuid;
  exception when invalid_text_representation then
    v_owner_id := null;
  end;

  if v_owner_type = 'order' and v_owner_id is not null then
    select o.title into v_title
    from public.orders o
    where o.id = v_owner_id and o.company_id = v.company_id;
    v_exists := found;
    v_parent_order_id := v_owner_id;
  elsif v_owner_type = 'object' and v_owner_id is not null then
    select o.name into v_title
    from public.client_objects o
    where o.id = v_owner_id and o.company_id = v.company_id;
    v_exists := found;
  elsif v_owner_type = 'finance_entry' and v_owner_id is not null then
    select e.title, e.order_id into v_title, v_parent_order_id
    from public.order_finance_entries e
    where e.id = v_owner_id and e.company_id = v.company_id;
    v_exists := found;
    if not v_exists then
      v_title := v.record_data -> 'finance_entry' ->> 'title';
      begin
        v_parent_order_id := nullif(v.record_data ->> 'parent_order_id', '')::uuid;
      exception when invalid_text_representation then
        v_parent_order_id := null;
      end;
    end if;
    if v_parent_order_id is not null then
      select o.title into v_order_title
      from public.orders o
      where o.id = v_parent_order_id and o.company_id = v.company_id;
      if not found then v_exists := false; end if;
    else
      v_exists := false;
    end if;
  end if;

  if v_exists then
    select t.id into v_trash_entry_id
    from public.trash_entries t
    where t.company_id = v.company_id
      and t.is_root
      and auth.uid() = any(t.access_user_ids)
      and (
        (v_owner_type = 'order' and t.entity_type = 'order' and t.entity_id = v_owner_id)
        or (v_owner_type = 'object' and t.entity_type = 'client_object' and t.entity_id = v_owner_id)
        or (v_owner_type = 'finance_entry' and t.entity_type = 'order' and t.entity_id = v_parent_order_id)
      )
    order by t.deleted_at desc
    limit 1;
    v_status := case when v_trash_entry_id is null then 'active' else 'trash' end;
  end if;

  v_title := nullif(btrim(coalesce(v_title, '')), '');
  if v_owner_type = 'finance_entry' then
    v_title := concat_ws(
      ' ' || U&'\00B7' || ' ',
      coalesce(v_title, U&'\0424\0438\043D\0430\043D\0441\043E\0432\0430\044F \0441\0442\0430\0442\044C\044F'),
      nullif(btrim(coalesce(v_order_title, '')), '')
    );
  elsif v_title is null then
    v_title := case v_owner_type
      when 'order' then U&'\0417\0430\044F\0432\043A\0430'
      when 'object' then U&'\041E\0431\044A\0435\043A\0442'
      else U&'\0418\0441\0445\043E\0434\043D\0430\044F \0441\0443\0449\043D\043E\0441\0442\044C'
    end;
  end if;

  return jsonb_build_object(
    'owner_type', v_owner_type,
    'owner_id', v_owner_id,
    'title', v_title,
    'status', v_status,
    'route_entity_id', case when v_owner_type = 'finance_entry' then v_parent_order_id else v_owner_id end,
    'finance_entry_id', case when v_owner_type = 'finance_entry' then v_owner_id else null end,
    'trash_entry_id', v_trash_entry_id
  );
end;
$$;

revoke all on function public.get_trash_media_origin(uuid) from public, anon;
grant execute on function public.get_trash_media_origin(uuid) to authenticated;
