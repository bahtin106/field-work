select count(*) as orphan_profiles
from public.profiles p
left join auth.users u on u.id = p.id
where u.id is null;

select p.id::text, p.email, p.full_name
from public.profiles p
left join auth.users u on u.id = p.id
where u.id is null
order by p.created_at desc nulls last
limit 20;
