with target as (
  select id from auth.users where lower(email)=lower('expresspoliv@gmail.com')
  union
  select id from public.profiles where lower(email)=lower('expresspoliv@gmail.com')
),
target_text as (
  select id::text as id from target
)
select 'auth.users' as tbl, count(*)::int as cnt from auth.users where lower(email)=lower('expresspoliv@gmail.com')
union all
select 'public.profiles', count(*)::int from public.profiles where lower(email)=lower('expresspoliv@gmail.com')
union all
select 'auth.identities', count(*)::int from auth.identities where user_id in (select id from target)
union all
select 'auth.sessions', count(*)::int from auth.sessions where user_id in (select id from target)
union all
select 'auth.refresh_tokens', count(*)::int from auth.refresh_tokens where user_id in (select id from target_text)
union all
select 'public.push_tokens', count(*)::int from public.push_tokens where user_id in (select id from target)
union all
select 'public.notification_prefs', count(*)::int from public.notification_prefs where user_id in (select id from target);
