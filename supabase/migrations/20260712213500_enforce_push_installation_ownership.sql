-- A physical app installation must route notifications to exactly one current
-- account. Older implementations only invalidated tokens inside the new
-- user_id, allowing a rotated token owned by a previous account to stay valid.

with ranked_installations as (
  select
    token,
    row_number() over (
      partition by device_id
      order by last_seen_at desc nulls last, token desc
    ) as ownership_rank
  from public.push_tokens
  where device_id is not null
    and btrim(device_id) <> ''
    and is_valid = true
)
update public.push_tokens as push_token
set
  is_valid = false,
  invalid_reason = 'DuplicateInstallationOwnership'
from ranked_installations as ranked
where ranked.ownership_rank > 1
  and ranked.token = push_token.token;

create unique index if not exists push_tokens_one_valid_owner_per_device_idx
  on public.push_tokens (device_id)
  where device_id is not null
    and btrim(device_id) <> ''
    and is_valid = true;

analyze public.push_tokens;
