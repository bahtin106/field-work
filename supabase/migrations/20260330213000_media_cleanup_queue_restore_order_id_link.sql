begin;

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
      object_key,
      company_id,
      order_id,
      reason,
      not_before
    )
    values (
      old.provider,
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

commit;

