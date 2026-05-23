create table if not exists public.registration_email_codes (
  email text not null,
  purpose text not null check (purpose in ('register', 'recovery')),
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  cooldown_until timestamptz not null,
  verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (email, purpose)
);

create index if not exists registration_email_codes_expires_at_idx
  on public.registration_email_codes (expires_at);

create table if not exists public.registration_email_proofs (
  token_hash text primary key,
  email text not null,
  purpose text not null check (purpose in ('register', 'recovery')),
  expires_at timestamptz not null,
  consumed boolean not null default false,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists registration_email_proofs_expires_at_idx
  on public.registration_email_proofs (expires_at);

alter table public.registration_email_codes enable row level security;
alter table public.registration_email_proofs enable row level security;
