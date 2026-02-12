-- Очистка поврежденных записей auth.users
-- Выполните ПОСЛЕ проверки check_auth_users.sql

-- ВНИМАНИЕ: Эти команды удалят данные. Будьте осторожны!

-- 1. Удалить конкретный проблемный email из auth.users
-- (замените на нужный email если другой)
DELETE FROM auth.users 
WHERE email ILIKE 'expresspoliv@gmail.com'
  AND id NOT IN (SELECT id FROM profiles);

-- 2. Удалить все orphaned auth.users (пользователи без профилей)
-- ОСТОРОЖНО: Это удалит всех пользователей auth без профилей
DELETE FROM auth.users 
WHERE id NOT IN (SELECT id FROM profiles WHERE id IS NOT NULL)
  AND deleted_at IS NULL
  AND created_at > NOW() - INTERVAL '7 days'; -- только за последние 7 дней

-- 3. Проверить результат
SELECT COUNT(*) as orphaned_users
FROM auth.users u
LEFT JOIN profiles p ON u.id = p.id
WHERE p.id IS NULL AND u.deleted_at IS NULL;
