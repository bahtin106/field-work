create or replace function public.enqueue_media_cleanup_from_profile_map_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(old.provider), '') in ('beget_s3', 'yandex_disk')
     and coalesce(trim(old.external_path), '') <> '' then
    insert into public.media_cleanup_queue (
      provider,
      bucket,
      object_key,
      company_id,
      entity_type,
      entity_id,
      reason,
      not_before
    )
    values (
      old.provider,
      null,
      old.external_path,
      old.company_id,
      old.entity_type,
      old.entity_id,
      'profile_map_delete',
      now()
    )
    on conflict (provider, object_key) do update
      set company_id = excluded.company_id,
          entity_type = excluded.entity_type,
          entity_id = excluded.entity_id,
          reason = excluded.reason,
          processed_at = null,
          locked_at = null,
          last_error = null,
          not_before = now(),
          updated_at = now();
  end if;

  return old;
end
$$;

create or replace function public.enqueue_media_cleanup_from_order_map_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(old.provider), '') in ('beget_s3', 'yandex_disk')
     and coalesce(trim(old.external_path), '') <> '' then
    insert into public.media_cleanup_queue (
      provider,
      bucket,
      object_key,
      company_id,
      order_id,
      reason,
      not_before
    )
    values (
      old.provider,
      null,
      old.external_path,
      old.company_id,
      old.order_id,
      'order_map_delete',
      now()
    )
    on conflict (provider, object_key) do update
      set company_id = excluded.company_id,
          order_id = excluded.order_id,
          reason = excluded.reason,
          processed_at = null,
          locked_at = null,
          last_error = null,
          not_before = now(),
          updated_at = now();
  end if;

  return old;
end
$$;

create or replace function public.delete_profile_media_map_for_entity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'profiles' then
    delete from public.profile_media_external_map
    where entity_type = 'employee'
      and entity_id = old.id;
  elsif tg_table_name = 'clients' then
    delete from public.profile_media_external_map
    where entity_type = 'client'
      and entity_id = old.id;
  elsif tg_table_name = 'client_objects' then
    delete from public.profile_media_external_map
    where entity_type = 'object'
      and entity_id = old.id;
  end if;

  return old;
end
$$;

drop trigger if exists trg_profile_media_external_map_enqueue_cleanup on public.profile_media_external_map;
create trigger trg_profile_media_external_map_enqueue_cleanup
after delete on public.profile_media_external_map
for each row
execute function public.enqueue_media_cleanup_from_profile_map_delete();

drop trigger if exists trg_order_media_external_map_enqueue_cleanup on public.order_media_external_map;
create trigger trg_order_media_external_map_enqueue_cleanup
after delete on public.order_media_external_map
for each row
execute function public.enqueue_media_cleanup_from_order_map_delete();

drop trigger if exists trg_profiles_delete_profile_media_map on public.profiles;
create trigger trg_profiles_delete_profile_media_map
after delete on public.profiles
for each row
execute function public.delete_profile_media_map_for_entity();

drop trigger if exists trg_clients_delete_profile_media_map on public.clients;
create trigger trg_clients_delete_profile_media_map
after delete on public.clients
for each row
execute function public.delete_profile_media_map_for_entity();

drop trigger if exists trg_client_objects_delete_profile_media_map on public.client_objects;
create trigger trg_client_objects_delete_profile_media_map
after delete on public.client_objects
for each row
execute function public.delete_profile_media_map_for_entity();
