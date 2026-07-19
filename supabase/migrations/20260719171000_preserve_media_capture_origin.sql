-- Persist the trusted client-side origin for newly uploaded media. Capture time
-- is accepted only by the media edge functions for photos taken in the app;
-- gallery files intentionally retain upload time without claiming a shoot time.

alter table public.order_media_external_map
  add column if not exists media_metadata jsonb not null default '{}'::jsonb;

alter table public.object_media_external_map
  add column if not exists media_metadata jsonb not null default '{}'::jsonb;

alter table public.finance_entry_media_external_map
  add column if not exists media_metadata jsonb not null default '{}'::jsonb;

create or replace function public.media_assets_set_upload_timestamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uploaded_at timestamptz;
  v_media_metadata jsonb := '{}'::jsonb;
begin
  new.metadata := coalesce(new.metadata, '{}'::jsonb);

  case new.entity_type
    when 'order' then
      select m.created_at, coalesce(m.media_metadata, '{}'::jsonb)
        into v_uploaded_at, v_media_metadata
      from public.order_media_external_map m
      where m.order_id = new.entity_id
        and m.category = new.category
        and m.source_url = new.source_url
      order by m.created_at asc
      limit 1;
    when 'object' then
      select m.created_at, coalesce(m.media_metadata, '{}'::jsonb)
        into v_uploaded_at, v_media_metadata
      from public.object_media_external_map m
      where m.object_id = new.entity_id
        and m.category = new.category
        and m.source_url = new.source_url
      order by m.created_at asc
      limit 1;
    when 'finance_entry' then
      select m.created_at, coalesce(m.media_metadata, '{}'::jsonb)
        into v_uploaded_at, v_media_metadata
      from public.finance_entry_media_external_map m
      where m.finance_entry_id = new.entity_id
        and m.source_url = new.source_url
      order by m.created_at asc
      limit 1;
    else
      v_uploaded_at := null;
  end case;

  new.metadata := new.metadata || coalesce(v_media_metadata, '{}'::jsonb);
  if v_uploaded_at is not null then
    new.metadata := new.metadata || jsonb_build_object('uploaded_at', v_uploaded_at);
  end if;
  return new;
end;
$$;

revoke all on function public.media_assets_set_upload_timestamp() from public, anon, authenticated;
grant execute on function public.media_assets_set_upload_timestamp() to service_role;

comment on function public.media_assets_set_upload_timestamp() is
  'Preserves upload time and validated media origin metadata from external media maps across catalog resyncs.';
