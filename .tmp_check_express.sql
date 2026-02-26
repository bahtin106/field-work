select 'users' as t, count(*) from auth.users where lower(email)='expresspoliv@gmail.com'
union all
select 'identities', count(*) from auth.identities where lower(email)='expresspoliv@gmail.com'
union all
select 'profiles', count(*) from public.profiles where lower(email)='expresspoliv@gmail.com';
