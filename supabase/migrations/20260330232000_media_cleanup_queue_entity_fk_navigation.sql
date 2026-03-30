begin;

alter table public.media_cleanup_queue
  add column if not exists feedback_id uuid,
  add column if not exists feedback_attachment_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'media_cleanup_queue_feedback_id_fkey'
      and conrelid = 'public.media_cleanup_queue'::regclass
  ) then
    alter table public.media_cleanup_queue
      add constraint media_cleanup_queue_feedback_id_fkey
      foreign key (feedback_id) references public.feedbacks(id) on delete set null;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'media_cleanup_queue_feedback_attachment_id_fkey'
      and conrelid = 'public.media_cleanup_queue'::regclass
  ) then
    alter table public.media_cleanup_queue
      add constraint media_cleanup_queue_feedback_attachment_id_fkey
      foreign key (feedback_attachment_id) references public.feedback_attachments(id) on delete set null;
  end if;
end
$$;

create index if not exists idx_media_cleanup_queue_feedback_id
  on public.media_cleanup_queue (feedback_id)
  where feedback_id is not null;

create index if not exists idx_media_cleanup_queue_feedback_attachment_id
  on public.media_cleanup_queue (feedback_attachment_id)
  where feedback_attachment_id is not null;

update public.media_cleanup_queue m
set feedback_id = m.entity_id
where m.feedback_id is null
  and m.entity_type = 'feedback'
  and m.entity_id is not null
  and exists (
    select 1
    from public.feedbacks f
    where f.id = m.entity_id
  );

update public.media_cleanup_queue m
set feedback_attachment_id = m.entity_id
where m.feedback_attachment_id is null
  and m.entity_type = 'feedback_attachment'
  and m.entity_id is not null
  and exists (
    select 1
    from public.feedback_attachments a
    where a.id = m.entity_id
  );

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
      object_key,
      company_id,
      entity_type,
      entity_id,
      feedback_id,
      feedback_attachment_id,
      reason,
      not_before,
      status,
      max_attempts
    )
    values (
      old.provider,
      old.external_path,
      old.company_id,
      old.entity_type,
      old.entity_id,
      case when old.entity_type = 'feedback' then old.entity_id else null end,
      case when old.entity_type = 'feedback_attachment' then old.entity_id else null end,
      'profile_map_delete',
      now(),
      'pending',
      case when old.entity_type in ('feedback', 'feedback_attachment') then 5 else 40 end
    )
    on conflict (provider, object_key) do update
      set company_id = excluded.company_id,
          entity_type = excluded.entity_type,
          entity_id = excluded.entity_id,
          feedback_id = excluded.feedback_id,
          feedback_attachment_id = excluded.feedback_attachment_id,
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
          max_attempts = excluded.max_attempts,
          updated_at = now();
  end if;

  return old;
end
$$;

commit;

