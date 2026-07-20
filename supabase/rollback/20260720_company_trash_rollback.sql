-- Manual rollback for 20260720150000_add_company_trash.sql and
-- 20260720160000_add_media_trash.sql.
--
-- Safety contract:
-- 1. Deploy the previous order-media-storage and object-media-storage functions first.
-- 2. Restore or permanently purge every Trash item.
-- 3. Run this script as one transaction.
-- The script aborts instead of making still-trashed records visible again.

begin;

do $$
begin
  if to_regclass('public.trash_entries') is not null
     and exists (select 1 from public.trash_entries limit 1) then
    raise exception 'Trash rollback refused: trash_entries is not empty';
  end if;
end;
$$;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'purge-expired-company-trash';
  end if;
exception when insufficient_privilege or undefined_function or undefined_table then
  raise notice 'pg_cron cleanup skipped';
end;
$$;

drop view if exists public.clients_secure;
alter view if exists public.clients_secure_including_trash_v1 rename to clients_secure;
drop view if exists public.client_objects_secure;
alter view if exists public.client_objects_secure_including_trash_v1 rename to client_objects_secure;
drop view if exists public.orders_accessible;
alter view if exists public.orders_accessible_including_trash_v1 rename to orders_accessible;

grant select on public.clients_secure, public.client_objects_secure, public.orders_accessible
  to authenticated, service_role;

drop trigger if exists orders_capture_delete_to_trash on public.orders;
drop trigger if exists clients_capture_delete_to_trash on public.clients;
drop trigger if exists client_objects_capture_delete_to_trash on public.client_objects;
drop trigger if exists orders_guard_trashed_update on public.orders;
drop trigger if exists clients_guard_trashed_update on public.clients;
drop trigger if exists client_objects_guard_trashed_update on public.client_objects;

drop function if exists public.trash_media_asset_v1(text, uuid, uuid, text, text, uuid);
drop function if exists public.trash_finance_media_asset_v1(uuid, uuid, text, uuid);
drop function if exists public.restore_trash_item(uuid);
drop function if exists public.purge_trash_item(uuid);
drop function if exists public.purge_expired_trash();
drop function if exists public.list_trash_items(text, text, text, integer, integer);
drop function if exists public.get_trash_item(uuid);
drop function if exists public.queue_trashed_media_cleanup(public.trash_entries);
drop function if exists public.queue_entity_media_cleanup(text, uuid, uuid);
drop function if exists public.guard_trashed_entity_mutation();
drop function if exists public.capture_deleted_entity();
drop function if exists public.trash_access_snapshot(uuid, text, jsonb);
drop function if exists public.current_user_has_trash_permission(text);
drop function if exists public.trash_permission_default(text, text);

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

delete from public.app_role_permissions
where key in ('canViewTrash', 'canRestoreTrash', 'canPurgeTrash');

drop table if exists public.trash_entries;

notify pgrst, 'reload schema';
commit;
