begin;

alter table public.feedbacks
  add column if not exists status text,
  add column if not exists status_updated_at timestamptz,
  add column if not exists status_updated_by uuid references auth.users(id) on delete set null;

update public.feedbacks
set
  status = case when coalesce(is_read, false) then 'viewed' else 'new' end,
  status_updated_at = coalesce(read_at, created_at, now())
where status is null or status_updated_at is null;

alter table public.feedbacks
  alter column status set default 'new',
  alter column status set not null,
  alter column status_updated_at set default now(),
  alter column status_updated_at set not null;

alter table public.feedbacks
  drop constraint if exists feedbacks_status_check;

alter table public.feedbacks
  add constraint feedbacks_status_check
  check (status in ('new', 'viewed', 'in_progress', 'completed'));

create index if not exists idx_feedbacks_status_created_at
  on public.feedbacks (status, created_at desc)
  where deletion_state <> 'pending_cleanup';

create index if not exists idx_feedbacks_user_created_at
  on public.feedbacks (user_id, created_at desc)
  where deletion_state <> 'pending_cleanup';

drop policy if exists feedbacks_select_own_support_requests on public.feedbacks;
create policy feedbacks_select_own_support_requests
on public.feedbacks
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists feedbacks_support_select_boundary on public.feedbacks;
create policy feedbacks_support_select_boundary
on public.feedbacks
as restrictive
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_super_admin())
);

drop policy if exists feedback_attachments_select_own_support_requests on public.feedback_attachments;
create policy feedback_attachments_select_own_support_requests
on public.feedback_attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.feedbacks f
    where f.id = feedback_attachments.feedback_id
      and f.user_id = (select auth.uid())
  )
);

drop policy if exists feedback_attachments_support_select_boundary on public.feedback_attachments;
create policy feedback_attachments_support_select_boundary
on public.feedback_attachments
as restrictive
for select
to authenticated
using (
  (select public.is_super_admin())
  or exists (
    select 1
    from public.feedbacks f
    where f.id = feedback_attachments.feedback_id
      and f.user_id = (select auth.uid())
  )
);

create or replace function public.enforce_support_request_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_is_super_admin boolean := false;
begin
  if v_uid is not null then
    v_is_super_admin := public.is_super_admin();
  end if;

  if tg_op = 'INSERT' then
    if v_uid is not null and not v_is_super_admin then
      new.status := 'new';
      new.status_updated_at := coalesce(new.created_at, now());
      new.status_updated_by := null;
      new.is_read := false;
      new.read_at := null;
      new.read_by := null;
    end if;
    return new;
  end if;

  if v_uid is not null and not v_is_super_admin and (
    new.status is distinct from old.status
    or new.status_updated_at is distinct from old.status_updated_at
    or new.status_updated_by is distinct from old.status_updated_by
    or new.is_read is distinct from old.is_read
    or new.read_at is distinct from old.read_at
    or new.read_by is distinct from old.read_by
  ) then
    raise exception 'Only a super administrator can change support request status'
      using errcode = '42501';
  end if;

  -- Keep older application versions compatible with the new status model.
  if new.status is not distinct from old.status
     and new.is_read is distinct from old.is_read then
    new.status := case when new.is_read then 'viewed' else 'new' end;
  end if;

  if new.status is distinct from old.status then
    if new.status_updated_at is not distinct from old.status_updated_at then
      new.status_updated_at := now();
    end if;
    if new.status = 'new' then
      new.is_read := false;
      new.read_at := null;
      new.read_by := null;
    else
      new.is_read := true;
      new.read_at := coalesce(new.read_at, old.read_at, now());
      new.read_by := coalesce(new.read_by, new.status_updated_by, old.read_by);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_support_request_workflow on public.feedbacks;
create trigger trg_enforce_support_request_workflow
before insert or update on public.feedbacks
for each row execute function public.enforce_support_request_workflow();

revoke all on function public.enforce_support_request_workflow() from public;

analyze public.feedbacks;

commit;
