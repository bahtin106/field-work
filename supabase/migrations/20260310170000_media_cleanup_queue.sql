create table if not exists public.media_cleanup_queue (
  id bigserial primary key,
  provider text not null,
  bucket text,
  object_key text not null,
  company_id uuid references public.companies(id) on delete cascade,
  entity_type text,
  entity_id uuid,
  order_id uuid references public.orders(id) on delete cascade,
  reason text,
  attempts integer not null default 0,
  last_error text,
  not_before timestamptz not null default now(),
  locked_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, object_key)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'media_cleanup_queue_provider_check'
      and conrelid = 'public.media_cleanup_queue'::regclass
  ) then
    alter table public.media_cleanup_queue
      add constraint media_cleanup_queue_provider_check
      check (provider in ('beget_s3', 'yandex_disk'));
  end if;
end
$$;

create index if not exists idx_media_cleanup_queue_pending
  on public.media_cleanup_queue (provider, processed_at, not_before, id);

create index if not exists idx_media_cleanup_queue_company
  on public.media_cleanup_queue (company_id, processed_at, id);

alter table public.media_cleanup_queue enable row level security;

revoke all on public.media_cleanup_queue from anon, authenticated;
grant select, insert, update, delete on public.media_cleanup_queue to service_role;
grant usage, select on sequence public.media_cleanup_queue_id_seq to service_role;
