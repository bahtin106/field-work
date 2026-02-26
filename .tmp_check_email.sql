select 'profiles' as src, id::text, email
from public.profiles
where lower(email)=lower('Expresspoliv@gmail.com')
union all
select 'auth' as src, id::text, email
from auth.users
where lower(email)=lower('Expresspoliv@gmail.com');
