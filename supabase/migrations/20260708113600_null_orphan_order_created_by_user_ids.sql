update public.orders o
set created_by_user_id = null
where o.created_by_user_id is not null
  and not exists (
    select 1
    from auth.users u
    where u.id = o.created_by_user_id
  );
