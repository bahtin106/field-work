select id, email, created_at, invited_at, email_confirmed_at, confirmation_sent_at
from auth.users
where lower(email)=lower('expresspoliv@gmail.com')
order by created_at desc;

select id, email, created_at
from public.profiles
where lower(email)=lower('expresspoliv@gmail.com')
order by created_at desc;
