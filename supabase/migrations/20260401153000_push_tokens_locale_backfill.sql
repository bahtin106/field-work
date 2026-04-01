-- Backfill push_tokens.locale from user profile locale where missing.
update public.push_tokens pt
set locale = p.locale
from public.profiles p
where p.id = pt.user_id
  and p.locale is not null
  and btrim(p.locale) <> ''
  and (pt.locale is null or btrim(pt.locale) = '');
