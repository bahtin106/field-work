-- Keep the original upload timestamp stable even when media_assets is rebuilt
-- after a photo list changes. The external media maps are the authoritative
-- upload records for the active Beget S3 and Yandex Disk providers.

create or replace function public.media_assets_set_upload_timestamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uploaded_at timestamptz;
begin
  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  if nullif(btrim(new.metadata ->> 'uploaded_at'), '') is not null then
    return new;
  end if;

  case new.entity_type
    when 'order' then
      select m.created_at
        into v_uploaded_at
      from public.order_media_external_map m
      where m.order_id = new.entity_id
        and m.category = new.category
        and m.source_url = new.source_url
      order by m.created_at asc
      limit 1;
    when 'object' then
      select m.created_at
        into v_uploaded_at
      from public.object_media_external_map m
      where m.object_id = new.entity_id
        and m.category = new.category
        and m.source_url = new.source_url
      order by m.created_at asc
      limit 1;
    when 'finance_entry' then
      select m.created_at
        into v_uploaded_at
      from public.finance_entry_media_external_map m
      where m.finance_entry_id = new.entity_id
        and m.source_url = new.source_url
      order by m.created_at asc
      limit 1;
    else
      v_uploaded_at := null;
  end case;

  if v_uploaded_at is not null then
    new.metadata := new.metadata || jsonb_build_object('uploaded_at', v_uploaded_at);
  end if;
  return new;
end;
$$;

revoke all on function public.media_assets_set_upload_timestamp() from public, anon, authenticated;
grant execute on function public.media_assets_set_upload_timestamp() to service_role;

drop trigger if exists trg_media_assets_set_upload_timestamp on public.media_assets;
create trigger trg_media_assets_set_upload_timestamp
before insert or update of entity_type, entity_id, category, source_url, metadata
on public.media_assets
for each row execute function public.media_assets_set_upload_timestamp();

update public.media_assets a
set metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object('uploaded_at', m.created_at)
from public.order_media_external_map m
where a.entity_type = 'order'
  and a.entity_id = m.order_id
  and a.category = m.category
  and a.source_url = m.source_url
  and nullif(btrim(a.metadata ->> 'uploaded_at'), '') is null;

update public.media_assets a
set metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object('uploaded_at', m.created_at)
from public.object_media_external_map m
where a.entity_type = 'object'
  and a.entity_id = m.object_id
  and a.category = m.category
  and a.source_url = m.source_url
  and nullif(btrim(a.metadata ->> 'uploaded_at'), '') is null;

update public.media_assets a
set metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object('uploaded_at', m.created_at)
from public.finance_entry_media_external_map m
where a.entity_type = 'finance_entry'
  and a.entity_id = m.finance_entry_id
  and a.source_url = m.source_url
  and nullif(btrim(a.metadata ->> 'uploaded_at'), '') is null;

comment on function public.media_assets_set_upload_timestamp() is
  'Preserves the authoritative external-map upload timestamp in media_assets.metadata across catalog resyncs.';
