select id, email, invited_at, confirmation_sent_at, created_at
from auth.users
where lower(email)=lower('expresspoliv@gmail.com')
order by created_at desc;
