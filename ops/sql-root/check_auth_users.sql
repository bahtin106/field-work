-- Проверка состояния auth.users для проблемного email
-- Выполните в Supabase SQL Editor

-- 1. Проверим записи в auth.users с этим email
SELECT 
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  deleted_at,
  is_sso_user
FROM auth.users 
WHERE email ILIKE '%expresspoliv%'
OR email ILIKE '%expresspoliv@gmail.com%';

-- 2. Проверим профили с этим email
SELECT 
  id,
  email,
  first_name,
  last_name,
  created_at
FROM profiles
WHERE email ILIKE '%expresspoliv%';

-- 3. Проверим orphaned auth.users (пользователи без профилей)
SELECT 
  u.id,
  u.email,
  u.created_at,
  p.id as profile_id
FROM auth.users u
LEFT JOIN profiles p ON u.id = p.id
WHERE p.id IS NULL
  AND u.deleted_at IS NULL
ORDER BY u.created_at DESC
LIMIT 20;
