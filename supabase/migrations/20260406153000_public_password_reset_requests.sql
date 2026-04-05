set search_path = public;

create table if not exists public.password_reset_requests (
  id bigserial primary key,
  email text not null,
  requested_at timestamptz not null default now(),
  ip_address text null,
  user_agent text null,
  status text not null default 'pending',
  user_id uuid null references public.profiles(id) on delete set null,
  error_message text null,
  constraint password_reset_requests_email_non_empty_chk check (length(btrim(email)) > 0),
  constraint password_reset_requests_status_chk check (
    status in ('pending', 'sent', 'rate_limited', 'user_not_found', 'failed')
  )
);

create index if not exists idx_password_reset_requests_email_requested_at
  on public.password_reset_requests (email, requested_at desc);

create index if not exists idx_password_reset_requests_user_id_requested_at
  on public.password_reset_requests (user_id, requested_at desc);

alter table public.password_reset_requests enable row level security;
alter table public.password_reset_requests force row level security;

drop policy if exists password_reset_requests_service_role_all on public.password_reset_requests;
create policy password_reset_requests_service_role_all
on public.password_reset_requests
for all
to service_role
using (true)
with check (true);

revoke all on table public.password_reset_requests from anon, authenticated, public;
grant select, insert, update on table public.password_reset_requests to service_role;
