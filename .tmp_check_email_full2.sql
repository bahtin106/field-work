create temp table tmp_ids as
select id from auth.users where lower(email)=lower('expresspoliv@gmail.com')
union
select id from public.profiles where lower(email)=lower('expresspoliv@gmail.com');

select 'auth.users' as src, id::text, email
from auth.users
where lower(email)=lower('expresspoliv@gmail.com')
union all
select 'public.profiles' as src, id::text, email
from public.profiles
where lower(email)=lower('expresspoliv@gmail.com');

select 'auth.identities' as src, count(*)::int as cnt
from auth.identities where user_id in (select id from tmp_ids)
union all
select 'auth.sessions', count(*)::int from auth.sessions where user_id in (select id from tmp_ids)
union all
select 'auth.refresh_tokens', count(*)::int from auth.refresh_tokens where user_id in (select id::text from tmp_ids)
union all
select 'public.push_tokens', count(*)::int from public.push_tokens where user_id in (select id from tmp_ids)
union all
select 'public.notification_prefs', count(*)::int from public.notification_prefs where user_id in (select id from tmp_ids);
