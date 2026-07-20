begin;

-- Existing order/finance map cleanup is intentionally bypassed while a file is
-- merely detached into Trash. Permanent purge reuses the same cleanup queue.
create or replace function public.enqueue_media_cleanup_from_order_map_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.trash_media_detach', true) = 'on' then
    return old;
  end if;
  if coalesce(trim(old.provider), '') in ('beget_s3', 'yandex_disk')
     and coalesce(trim(old.external_path), '') <> '' then
    insert into public.media_cleanup_queue (
      provider, object_key, company_id, order_id, reason, not_before, status, max_attempts
    ) values (
      old.provider, old.external_path, old.company_id, old.order_id,
      'order_map_delete', now(), 'pending', 40
    )
    on conflict (provider, object_key) do update set
      company_id = excluded.company_id,
      order_id = excluded.order_id,
      reason = excluded.reason,
      processed_at = null,
      succeeded_at = null,
      failed_at = null,
      dead_letter_at = null,
      status = 'pending',
      locked_at = null,
      lock_expires_at = null,
      claimed_by = null,
      error_code = null,
      last_error = null,
      not_before = now(),
      max_attempts = 40,
      updated_at = now();
  end if;
  return old;
end;
$$;

create or replace function public.trash_media_asset_v1(
  p_owner_type text,
  p_owner_id uuid,
  p_company_id uuid,
  p_category text,
  p_url text,
  p_deleted_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_owner jsonb;
  v_map jsonb;
  v_asset jsonb;
  v_asset_id uuid;
  v_access uuid[];
  v_result jsonb;
  v_title text;
begin
  if p_owner_type not in ('order', 'object') or p_owner_id is null or p_company_id is null
     or btrim(coalesce(p_category, '')) = '' or btrim(coalesce(p_url, '')) = '' then
    raise exception 'Invalid media trash request' using errcode = '22023';
  end if;

  if p_owner_type = 'order' then
    select to_jsonb(o) into v_owner from public.orders o
    where o.id = p_owner_id and o.company_id = p_company_id for update;
    select to_jsonb(m) into v_map from public.order_media_external_map m
    where m.order_id = p_owner_id and m.company_id = p_company_id and m.category = p_category
      and (m.source_url = p_url or m.display_url = p_url)
    order by m.id limit 1;
  else
    select to_jsonb(o) into v_owner from public.client_objects o
    where o.id = p_owner_id and o.company_id = p_company_id for update;
    select to_jsonb(m) into v_map from public.object_media_external_map m
    where m.object_id = p_owner_id and m.company_id = p_company_id and m.category = p_category
      and (m.source_url = p_url or m.display_url = p_url)
    order by m.id limit 1;
  end if;
  if v_owner is null then raise exception 'Media owner not found' using errcode = 'P0002'; end if;

  -- Network retries and background queues may repeat a successful request after
  -- the response was lost. Treat the same owner/category/source as idempotent.
  if exists (
    select 1
    from public.trash_entries t
    where t.company_id = p_company_id
      and t.entity_type = 'media'
      and t.record_data ->> 'owner_type' = p_owner_type
      and t.record_data ->> 'owner_id' = p_owner_id::text
      and t.record_data ->> 'category' = p_category
      and (
        t.record_data ->> 'source_url' = p_url
        or t.thumbnail_url = p_url
      )
  ) then
    if p_owner_type = 'order' then
      select to_jsonb(r) into v_result from public.remove_order_media_url_v2(
        p_owner_id, p_company_id, p_category, p_url
      ) r;
    else
      select to_jsonb(r) into v_result from public.remove_object_media_url_v1(
        p_owner_id, p_company_id, p_category, p_url
      ) r;
    end if;
    return coalesce(v_result, jsonb_build_object('media_urls', '[]'::jsonb));
  end if;

  select a.id, to_jsonb(a) into v_asset_id, v_asset
  from public.media_assets a
  where a.company_id = p_company_id
    and a.entity_id = p_owner_id
    and a.category = p_category
    and (a.source_url = p_url or a.display_url = p_url)
  order by a.updated_at desc limit 1;
  v_asset_id := coalesce(v_asset_id, gen_random_uuid());
  v_map := coalesce(v_map, jsonb_build_object(
    'company_id', p_company_id,
    case when p_owner_type = 'order' then 'order_id' else 'object_id' end, p_owner_id,
    'category', p_category, 'source_url', p_url, 'display_url', p_url,
    'provider', coalesce(v_asset ->> 'provider', 'unknown'),
    'external_path', v_asset ->> 'storage_path',
    'created_by', p_deleted_by,
    'file_size_bytes', coalesce((v_asset ->> 'file_size_bytes')::bigint, 0)
  ));

  v_access := public.trash_access_snapshot(
    p_company_id,
    case when p_owner_type = 'order' then 'order' else 'client_object' end,
    v_owner
  );
  if p_deleted_by is not null and not (p_deleted_by = any(v_access)) then
    v_access := array_append(v_access, p_deleted_by);
  end if;
  v_title := coalesce(nullif(regexp_replace(split_part(p_url, '?', 1), '^.*/', ''), ''), 'Фотография');

  insert into public.trash_entries (
    company_id, entity_type, entity_id, deletion_batch_id, is_root,
    title, subtitle, thumbnail_url, record_data, access_user_ids, deleted_by
  ) values (
    p_company_id, 'media', v_asset_id, gen_random_uuid(), true,
    v_title,
    case when p_owner_type = 'order' then 'Фото заявки' else 'Фото объекта' end,
    coalesce(v_map ->> 'source_url', p_url, v_map ->> 'display_url'),
    jsonb_build_object(
      'owner_type', p_owner_type, 'owner_id', p_owner_id, 'company_id', p_company_id,
      'category', p_category, 'source_url', coalesce(v_map ->> 'source_url', p_url),
      'map', v_map, 'asset', coalesce(v_asset, '{}'::jsonb)
    ),
    v_access, p_deleted_by
  ) on conflict (entity_type, entity_id) do nothing;

  if p_owner_type = 'order' then
    select to_jsonb(r) into v_result from public.remove_order_media_url_v2(
      p_owner_id, p_company_id, p_category, coalesce(v_map ->> 'source_url', p_url)
    ) r;
    perform set_config('app.trash_media_detach', 'on', true);
    delete from public.order_media_external_map
    where company_id = p_company_id and order_id = p_owner_id and category = p_category
      and (source_url = coalesce(v_map ->> 'source_url', p_url) or display_url = p_url);
  else
    select to_jsonb(r) into v_result from public.remove_object_media_url_v1(
      p_owner_id, p_company_id, p_category, coalesce(v_map ->> 'source_url', p_url)
    ) r;
    perform set_config('app.trash_media_detach', 'on', true);
    delete from public.object_media_external_map
    where company_id = p_company_id and object_id = p_owner_id and category = p_category
      and (source_url = coalesce(v_map ->> 'source_url', p_url) or display_url = p_url);
  end if;
  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.trash_media_asset_v1(text,uuid,uuid,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.trash_media_asset_v1(text,uuid,uuid,text,text,uuid) to service_role;

create or replace function public.trash_finance_media_asset_v1(
  p_finance_entry_id uuid,
  p_company_id uuid,
  p_url text,
  p_deleted_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_entry jsonb;
  v_order jsonb;
  v_order_id uuid;
  v_map jsonb;
  v_asset jsonb;
  v_asset_id uuid;
  v_access uuid[];
  v_result jsonb;
begin
  if p_finance_entry_id is null or p_company_id is null or btrim(coalesce(p_url, '')) = '' then
    raise exception 'Invalid finance media trash request' using errcode = '22023';
  end if;

  select to_jsonb(e), e.order_id into v_entry, v_order_id
  from public.order_finance_entries e
  where e.id = p_finance_entry_id and e.company_id = p_company_id
  for update;
  if v_entry is null then raise exception 'Finance entry not found' using errcode = 'P0002'; end if;
  select to_jsonb(o) into v_order from public.orders o
  where o.id = v_order_id and o.company_id = p_company_id;
  if v_order is null then raise exception 'Parent request not found' using errcode = 'P0002'; end if;

  select to_jsonb(m) into v_map from public.finance_entry_media_external_map m
  where m.finance_entry_id = p_finance_entry_id and m.company_id = p_company_id
    and (m.source_url = p_url or m.display_url = p_url)
  order by m.id limit 1;

  if exists (
    select 1 from public.trash_entries t
    where t.company_id = p_company_id and t.entity_type = 'media'
      and t.record_data ->> 'owner_type' = 'finance_entry'
      and t.record_data ->> 'owner_id' = p_finance_entry_id::text
      and (t.record_data ->> 'source_url' = p_url or t.thumbnail_url = p_url)
  ) then
    select to_jsonb(r) into v_result from public.remove_order_finance_entry_photo_url(
      p_finance_entry_id, p_company_id, p_url, p_deleted_by
    ) r;
    return coalesce(v_result, jsonb_build_object('photo_urls', '[]'::jsonb));
  end if;

  select a.id, to_jsonb(a) into v_asset_id, v_asset
  from public.media_assets a
  where a.company_id = p_company_id and a.entity_id = p_finance_entry_id
    and (a.source_url = p_url or a.display_url = p_url)
  order by a.updated_at desc limit 1;
  v_asset_id := coalesce(v_asset_id, gen_random_uuid());
  v_map := coalesce(v_map, jsonb_build_object(
    'company_id', p_company_id, 'order_id', v_order_id,
    'finance_entry_id', p_finance_entry_id, 'provider', coalesce(v_asset ->> 'provider', 'unknown'),
    'source_url', p_url, 'display_url', p_url, 'external_path', v_asset ->> 'storage_path',
    'created_by', p_deleted_by, 'file_size_bytes', coalesce((v_asset ->> 'file_size_bytes')::bigint, 0)
  ));
  v_access := public.trash_access_snapshot(p_company_id, 'order', v_order);
  if p_deleted_by is not null and not (p_deleted_by = any(v_access)) then
    v_access := array_append(v_access, p_deleted_by);
  end if;

  insert into public.trash_entries (
    company_id, entity_type, entity_id, deletion_batch_id, is_root,
    title, subtitle, thumbnail_url, record_data, access_user_ids, deleted_by
  ) values (
    p_company_id, 'media', v_asset_id, gen_random_uuid(), true,
    coalesce(nullif(regexp_replace(split_part(p_url, '?', 1), '^.*/', ''), ''), 'Photo'),
    'Finance entry photo', coalesce(v_map ->> 'source_url', p_url, v_map ->> 'display_url'),
    jsonb_build_object(
      'owner_type', 'finance_entry', 'owner_id', p_finance_entry_id,
      'parent_order_id', v_order_id, 'company_id', p_company_id,
      'category', 'finance_entry_photo', 'source_url', coalesce(v_map ->> 'source_url', p_url),
      'map', v_map, 'asset', coalesce(v_asset, '{}'::jsonb), 'finance_entry', v_entry
    ),
    v_access, p_deleted_by
  );

  select to_jsonb(r) into v_result from public.remove_order_finance_entry_photo_url(
    p_finance_entry_id, p_company_id, coalesce(v_map ->> 'source_url', p_url), p_deleted_by
  ) r;
  perform set_config('app.trash_media_detach', 'on', true);
  delete from public.finance_entry_media_external_map
  where company_id = p_company_id and finance_entry_id = p_finance_entry_id
    and (source_url = coalesce(v_map ->> 'source_url', p_url) or display_url = p_url);
  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.trash_finance_media_asset_v1(uuid,uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.trash_finance_media_asset_v1(uuid,uuid,text,uuid) to service_role;

create or replace function public.restore_trash_item(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v public.trash_entries; v_map jsonb; v_owner_type text; v_source text;
begin
  if not public.current_user_has_trash_permission('canRestoreTrash') then
    raise exception 'Trash restore denied' using errcode = '42501';
  end if;
  select * into v from public.trash_entries t
  where t.id = p_id and t.is_root and t.company_id = public.user_company_id()
    and auth.uid() = any(t.access_user_ids) for update;
  if not found then raise exception 'Trash item not found' using errcode = 'P0002'; end if;

  if v.entity_type = 'media' then
    v_map := v.record_data -> 'map';
    v_owner_type := v.record_data ->> 'owner_type';
    v_source := v.record_data ->> 'source_url';
    if exists (
      select 1 from public.trash_entries parent
      where parent.entity_id = case
          when v_owner_type = 'finance_entry' then (v.record_data ->> 'parent_order_id')::uuid
          else (v.record_data ->> 'owner_id')::uuid
        end
        and parent.entity_type = case
          when v_owner_type in ('order', 'finance_entry') then 'order'
          else 'client_object'
        end
    ) then raise exception 'Restore the parent entity first' using errcode = '55000'; end if;

    if v_owner_type = 'order' then
      perform public.append_order_media_url_v2(
        (v.record_data ->> 'owner_id')::uuid, v.company_id, v.record_data ->> 'category', v_source
      );
      insert into public.order_media_external_map (
        company_id, order_id, category, provider, source_url, external_path,
        created_by, display_url, display_url_updated_at, file_size_bytes, media_metadata
      ) values (
        v.company_id, (v.record_data ->> 'owner_id')::uuid, v.record_data ->> 'category',
        coalesce(v_map ->> 'provider', 'unknown'), v_source, v_map ->> 'external_path',
        nullif(v_map ->> 'created_by', '')::uuid, v_map ->> 'display_url',
        nullif(v_map ->> 'display_url_updated_at', '')::timestamptz,
        coalesce((v_map ->> 'file_size_bytes')::bigint, 0), coalesce(v_map -> 'media_metadata', '{}'::jsonb)
      ) on conflict (order_id, category, source_url) do update set
        display_url = excluded.display_url, external_path = excluded.external_path,
        file_size_bytes = excluded.file_size_bytes, media_metadata = excluded.media_metadata;
    elsif v_owner_type = 'object' then
      perform public.append_object_media_url_v1(
        (v.record_data ->> 'owner_id')::uuid, v.company_id, v.record_data ->> 'category', v_source
      );
      insert into public.object_media_external_map (
        company_id, object_id, category, provider, source_url, external_path,
        display_url, display_url_updated_at, file_size_bytes, created_by, media_metadata
      ) values (
        v.company_id, (v.record_data ->> 'owner_id')::uuid, v.record_data ->> 'category',
        coalesce(v_map ->> 'provider', 'unknown'), v_source, v_map ->> 'external_path',
        v_map ->> 'display_url', nullif(v_map ->> 'display_url_updated_at', '')::timestamptz,
        coalesce((v_map ->> 'file_size_bytes')::bigint, 0),
        nullif(v_map ->> 'created_by', '')::uuid, coalesce(v_map -> 'media_metadata', '{}'::jsonb)
      ) on conflict (object_id, category, source_url) do update set
        display_url = excluded.display_url, external_path = excluded.external_path,
        file_size_bytes = excluded.file_size_bytes, media_metadata = excluded.media_metadata;
    elsif v_owner_type = 'finance_entry' then
      perform public.append_order_finance_entry_photo_url(
        (v.record_data ->> 'owner_id')::uuid, v.company_id, v_source, auth.uid()
      );
      insert into public.finance_entry_media_external_map (
        company_id, order_id, finance_entry_id, provider, source_url, external_path,
        display_url, display_url_updated_at, created_by, file_size_bytes, media_metadata
      ) values (
        v.company_id, (v.record_data ->> 'parent_order_id')::uuid,
        (v.record_data ->> 'owner_id')::uuid, coalesce(v_map ->> 'provider', 'unknown'),
        v_source, v_map ->> 'external_path', v_map ->> 'display_url',
        nullif(v_map ->> 'display_url_updated_at', '')::timestamptz,
        nullif(v_map ->> 'created_by', '')::uuid,
        coalesce((v_map ->> 'file_size_bytes')::bigint, 0),
        coalesce(v_map -> 'media_metadata', '{}'::jsonb)
      ) on conflict (finance_entry_id, source_url) do update set
        display_url = excluded.display_url, external_path = excluded.external_path,
        file_size_bytes = excluded.file_size_bytes, media_metadata = excluded.media_metadata;
    else
      raise exception 'Unsupported media owner' using errcode = '22023';
    end if;
    update public.media_assets set status = 'ready', deleted_at = null, updated_at = now()
    where id = v.entity_id or (
      company_id = v.company_id and entity_id = (v.record_data ->> 'owner_id')::uuid
      and category = v.record_data ->> 'category' and source_url = v_source
    );
  end if;
  delete from public.trash_entries where deletion_batch_id = v.deletion_batch_id;
  return true;
end;
$$;

create or replace function public.queue_trashed_media_cleanup(p_entry public.trash_entries)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_map jsonb := p_entry.record_data -> 'map'; v_key text;
begin
  v_key := nullif(v_map ->> 'external_path', '');
  if v_key is not null then
    insert into public.media_cleanup_queue (
      provider, object_key, company_id, entity_type, entity_id, order_id, reason
    ) values (
      coalesce(nullif(v_map ->> 'provider', ''), 'beget_s3'), v_key,
      p_entry.company_id, 'media', p_entry.entity_id,
      case
        when p_entry.record_data ->> 'owner_type' = 'order'
          then (p_entry.record_data ->> 'owner_id')::uuid
        when p_entry.record_data ->> 'owner_type' = 'finance_entry'
          then (p_entry.record_data ->> 'parent_order_id')::uuid
        else null
      end,
      'trash_retention_expired'
    )
    on conflict (provider, object_key) do update set
      company_id = excluded.company_id,
      entity_type = excluded.entity_type,
      entity_id = excluded.entity_id,
      order_id = excluded.order_id,
      reason = excluded.reason,
      status = 'pending',
      attempts = 0,
      last_error = null,
      not_before = now(),
      locked_at = null,
      lock_expires_at = null,
      processed_at = null,
      succeeded_at = null,
      failed_at = null,
      dead_letter_at = null,
      updated_at = now();
  end if;
  delete from public.media_assets where id = p_entry.entity_id;
end;
$$;

create or replace function public.queue_entity_media_cleanup(
  p_entity_type text,
  p_entity_id uuid,
  p_company_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v record;
begin
  for v in
    select provider, external_path, order_id, 'order'::text as owner_type, order_id as owner_id
    from public.order_media_external_map
    where p_entity_type = 'order' and company_id = p_company_id and order_id = p_entity_id
    union all
    select provider, external_path, order_id, 'finance_entry', finance_entry_id
    from public.finance_entry_media_external_map
    where p_entity_type = 'order' and company_id = p_company_id and order_id = p_entity_id
    union all
    select m.provider, m.external_path, null::uuid, 'client_object', m.object_id
    from public.object_media_external_map m
    where p_entity_type = 'client_object' and m.company_id = p_company_id and m.object_id = p_entity_id
    union all
    select m.provider, m.external_path, null::uuid, 'client_object', m.object_id
    from public.object_media_external_map m
    join public.client_objects o on o.id = m.object_id and o.company_id = m.company_id
    where p_entity_type = 'client' and m.company_id = p_company_id and o.client_id = p_entity_id
  loop
    if nullif(v.external_path, '') is null then continue; end if;
    insert into public.media_cleanup_queue (
      provider, object_key, company_id, entity_type, entity_id, order_id, reason
    ) values (
      coalesce(nullif(v.provider, ''), 'beget_s3'), v.external_path, p_company_id,
      v.owner_type, v.owner_id, v.order_id, 'trash_retention_expired'
    )
    on conflict (provider, object_key) do update set
      company_id = excluded.company_id,
      entity_type = excluded.entity_type,
      entity_id = excluded.entity_id,
      order_id = excluded.order_id,
      reason = excluded.reason,
      status = 'pending',
      attempts = 0,
      last_error = null,
      not_before = now(),
      locked_at = null,
      lock_expires_at = null,
      processed_at = null,
      succeeded_at = null,
      failed_at = null,
      dead_letter_at = null,
      updated_at = now();
  end loop;
end;
$$;

create or replace function public.purge_trash_item(p_id uuid)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, auth as $$
declare v public.trash_entries;
begin
  if not public.current_user_has_trash_permission('canPurgeTrash') then raise exception 'Trash purge denied' using errcode='42501'; end if;
  select * into v from public.trash_entries t where t.id=p_id and t.is_root
    and t.company_id=public.user_company_id() and auth.uid()=any(t.access_user_ids) for update;
  if not found then raise exception 'Trash item not found' using errcode='P0002'; end if;
  perform set_config('app.trash_hard_delete','on',true);
  if v.entity_type='order' then
    perform public.queue_entity_media_cleanup(v.entity_type,v.entity_id,v.company_id);
    perform set_config('app.trash_media_detach','on',true);
    delete from public.orders where id=v.entity_id and company_id=v.company_id;
  elsif v.entity_type='client' then
    perform public.queue_entity_media_cleanup(v.entity_type,v.entity_id,v.company_id);
    perform set_config('app.trash_media_detach','on',true);
    delete from public.clients where id=v.entity_id and company_id=v.company_id;
  elsif v.entity_type='client_object' then
    perform public.queue_entity_media_cleanup(v.entity_type,v.entity_id,v.company_id);
    perform set_config('app.trash_media_detach','on',true);
    delete from public.client_objects where id=v.entity_id and company_id=v.company_id;
  elsif v.entity_type='media' then perform public.queue_trashed_media_cleanup(v);
  end if;
  delete from public.trash_entries where deletion_batch_id=v.deletion_batch_id;
  return true;
end; $$;

create or replace function public.purge_expired_trash()
returns integer language plpgsql security definer
set search_path = pg_catalog, public, auth as $$
declare v public.trash_entries; v_count integer:=0;
begin
  perform set_config('app.trash_hard_delete','on',true);
  for v in select * from public.trash_entries where is_root and purge_at<=now() order by purge_at for update skip locked loop
    if v.entity_type in ('order','client','client_object') then
      perform public.queue_entity_media_cleanup(v.entity_type,v.entity_id,v.company_id);
      perform set_config('app.trash_media_detach','on',true);
      if v.entity_type='order' then delete from public.orders where id=v.entity_id and company_id=v.company_id;
      elsif v.entity_type='client' then delete from public.clients where id=v.entity_id and company_id=v.company_id;
      else delete from public.client_objects where id=v.entity_id and company_id=v.company_id;
      end if;
    elsif v.entity_type='media' then perform public.queue_trashed_media_cleanup(v);
    end if;
    delete from public.trash_entries where deletion_batch_id=v.deletion_batch_id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end; $$;

revoke all on function public.queue_trashed_media_cleanup(public.trash_entries) from public, anon, authenticated;
grant execute on function public.queue_trashed_media_cleanup(public.trash_entries) to service_role;
revoke all on function public.queue_entity_media_cleanup(text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.queue_entity_media_cleanup(text,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
