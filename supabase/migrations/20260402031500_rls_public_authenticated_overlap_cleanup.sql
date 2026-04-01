set search_path = public;

-- companies: keep explicit authenticated policies only.
drop policy if exists "Users can view their company" on public.companies;
drop policy if exists "Admins can update their company" on public.companies;

-- push_tokens: remove legacy broad FOR ALL policy; keep per-command authenticated policies.
drop policy if exists "Users manage own push tokens" on public.push_tokens;
