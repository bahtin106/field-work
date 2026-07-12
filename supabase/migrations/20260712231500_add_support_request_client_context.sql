begin;

create table if not exists public.feedback_client_context (
  feedback_id uuid primary key references public.feedbacks(id) on delete cascade,
  platform text,
  device_name text,
  manufacturer text,
  model text,
  os_name text,
  os_version text,
  app_version text,
  app_build text,
  app_id text,
  runtime_version text,
  execution_environment text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.feedback_client_context enable row level security;

revoke all on table public.feedback_client_context from anon, authenticated;
grant insert, select on table public.feedback_client_context to authenticated;
grant all on table public.feedback_client_context to service_role;

drop policy if exists feedback_client_context_insert_own on public.feedback_client_context;
create policy feedback_client_context_insert_own
on public.feedback_client_context
for insert
to authenticated
with check (
  exists (
    select 1
    from public.feedbacks f
    where f.id = feedback_client_context.feedback_id
      and f.user_id = (select auth.uid())
  )
);

drop policy if exists feedback_client_context_select_super_admin on public.feedback_client_context;
create policy feedback_client_context_select_super_admin
on public.feedback_client_context
for select
to authenticated
using ((select public.is_super_admin()));

create index if not exists idx_feedback_client_context_created_at
  on public.feedback_client_context (created_at desc);

analyze public.feedback_client_context;

commit;
