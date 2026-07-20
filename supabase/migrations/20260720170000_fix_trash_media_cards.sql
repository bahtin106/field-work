-- Keep media cards readable and immediately previewable after their live media
-- mapping is detached. Unicode escape strings keep this migration independent
-- from the client encoding used by a deployment shell.

create or replace function public.normalize_trash_media_card()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_map jsonb := coalesce(new.record_data -> 'map', '{}'::jsonb);
  v_asset jsonb := coalesce(new.record_data -> 'asset', '{}'::jsonb);
  v_owner_type text := coalesce(new.record_data ->> 'owner_type', '');
  v_path text;
  v_filename text;
begin
  if new.entity_type <> 'media' then
    return new;
  end if;

  v_path := coalesce(
    nullif(v_map ->> 'external_path', ''),
    nullif(v_asset ->> 'storage_path', ''),
    nullif(v_map ->> 'source_url', ''),
    nullif(new.record_data ->> 'source_url', ''),
    ''
  );
  v_filename := nullif(regexp_replace(split_part(v_path, '?', 1), '^.*/', ''), '');
  if v_filename is not null and lower(v_path) not like 'yadisk://%' then
    new.title := v_filename;
  elsif btrim(coalesce(new.title, '')) = '' then
    new.title := U&'\0424\043E\0442\043E\0433\0440\0430\0444\0438\044F';
  end if;

  new.subtitle := case v_owner_type
    when 'order' then U&'\0424\043E\0442\043E \0437\0430\044F\0432\043A\0438'
    when 'object' then U&'\0424\043E\0442\043E \043E\0431\044A\0435\043A\0442\0430'
    when 'finance_entry' then U&'\0424\043E\0442\043E \0444\0438\043D\0430\043D\0441\043E\0432\043E\0439 \0437\0430\043F\0438\0441\0438'
    else U&'\0424\043E\0442\043E\0433\0440\0430\0444\0438\044F'
  end;
  new.thumbnail_url := coalesce(
    nullif(v_asset ->> 'thumb_url', ''),
    nullif(v_map ->> 'display_url', ''),
    nullif(v_asset ->> 'display_url', ''),
    nullif(new.thumbnail_url, ''),
    nullif(v_map ->> 'source_url', ''),
    nullif(new.record_data ->> 'source_url', '')
  );
  return new;
end;
$$;

revoke all on function public.normalize_trash_media_card() from public, anon, authenticated;

drop trigger if exists trg_normalize_trash_media_card on public.trash_entries;
create trigger trg_normalize_trash_media_card
before insert or update of title, subtitle, thumbnail_url, record_data
on public.trash_entries
for each row execute function public.normalize_trash_media_card();

-- Repair cards that were created before the normalizer existed. Assigning the
-- current title intentionally invokes the trigger without changing lifecycle data.
update public.trash_entries
set title = title
where entity_type = 'media';
