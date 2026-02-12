-- Find all orphaned auth.users
SELECT 
  au.id, 
  au.email, 
  au.created_at, 
  CASE WHEN p.id IS NULL THEN 'ORPHANED' ELSE 'HAS_PROFILE' END as status
FROM auth.users au
LEFT JOIN public.profiles p ON au.id = p.id
WHERE au.deleted_at IS NULL
ORDER BY au.created_at DESC
LIMIT 20;
