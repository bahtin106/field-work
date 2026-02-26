select 'orphans' as metric, count(*)::int as value
from auth.users au
left join public.profiles p on p.id=au.id
where p.id is null;

select 'duplicate_emails' as metric, count(*)::int as value
from (
  select lower(email)
  from auth.users
  where email is not null and trim(email) <> ''
  group by lower(email)
  having count(*) > 1
) d;

select 'orphan_identities' as metric, count(*)::int as value
from auth.identities i
left join auth.users u on u.id=i.user_id
where u.id is null;

select i.id, i.user_id, i.email, i.provider, i.created_at
from auth.identities i
left join auth.users u on u.id=i.user_id
where u.id is null
order by i.created_at desc
limit 30;
