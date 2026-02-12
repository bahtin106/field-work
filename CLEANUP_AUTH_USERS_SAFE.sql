-- CLEANUP ORPHANED AUTH.USERS
-- Удаляет пользователей из auth.users которые:
-- 1. Не имеют профиля в public.profiles
-- 2. Имеют невалидный email
-- 3. Помечены как deleted (в Supabase это поле есть)

-- BACKUP: Before running this, export auth.users:
-- SELECT * FROM auth.users WHERE created_at > NOW() - INTERVAL '7 days';

BEGIN;

-- Шаг 1: Посмотреть orphaned users
SELECT 
  au.id,
  au.email,
  au.created_at,
  au.updated_at,
  CASE WHEN p.id IS NULL THEN 'NO PROFILE' ELSE 'HAS PROFILE' END as status
FROM auth.users au
LEFT JOIN public.profiles p ON au.id = p.id
WHERE p.id IS NULL
  AND au.created_at > NOW() - INTERVAL '30 days'
  AND au.email IS NOT NULL
ORDER BY au.created_at DESC;

-- Шаг 2: Удалить orphaned users (те что без профилей)
DELETE FROM auth.users 
WHERE id IN (
  SELECT au.id
  FROM auth.users au
  LEFT JOIN public.profiles p ON au.id = p.id
  WHERE p.id IS NULL
    AND au.created_at > NOW() - INTERVAL '30 days'
)
AND email NOT IN (
  SELECT email FROM public.profiles WHERE email IS NOT NULL
);

-- Шаг 3: Результат
SELECT COUNT(*) as remaining_orphaned FROM auth.users au
LEFT JOIN public.profiles p ON au.id = p.id
WHERE p.id IS NULL;

COMMIT;
