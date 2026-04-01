-- push_tokens safe hardening without changing notification flow

-- 1) get_push_tokens_bulk should be callable only by worker (service_role)
revoke execute on function public.get_push_tokens_bulk(uuid[]) from public, anon, authenticated;
grant execute on function public.get_push_tokens_bulk(uuid[]) to service_role;

-- 2) one-time cleanup: keep only latest valid token per (user_id, device_id)
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, device_id
      order by coalesce(last_seen_at, updated_at, created_at) desc, id desc
    ) as rn
  from public.push_tokens
  where coalesce(is_valid, true) = true
)
update public.push_tokens pt
set
  is_valid = false,
  invalid_reason = coalesce(nullif(pt.invalid_reason, ''), 'superseded_by_newer_token'),
  updated_at = now()
from ranked r
where pt.id = r.id
  and r.rn > 1;
