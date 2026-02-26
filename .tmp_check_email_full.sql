with u as (
  select id, email from auth.users where lower(email)=lower('expresspoliv@gmail.com')
), p as (
  select id, email from public.profiles where lower(email)=lower('expresspoliv@gmail.com')
), all_ids as (
  select id from u
  union
  select id from p
)
select 'auth.users' as src, id::text, email from u
union all
select 'public.profiles' as src, id::text, email from p;

select 'auth.identities' as src, count(*)::int as cnt
from auth.identities where user_id in (select id from all_ids)
union all
select 'auth.sessions', count(*)::int from auth.sessions where user_id in (select id from all_ids)
union all
select 'auth.refresh_tokens', count(*)::int from auth.refresh_tokens where user_id in (select id::text from all_ids)
union all
select 'public.push_tokens', count(*)::int from public.push_tokens where user_id in (select id from all_ids)
union all
select 'public.notification_prefs', count(*)::int from public.notification_prefs where user_id in (select id from all_ids);
