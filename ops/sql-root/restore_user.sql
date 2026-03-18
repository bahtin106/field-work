-- ===================================================================
-- БЫСТРОЕ ВОССТАНОВЛЕНИЕ ПОЛЬЗОВАТЕЛЯ В SELF-HOSTED SUPABASE
-- ===================================================================
-- Выполните этот скрипт в Supabase Studio → SQL Editor
-- или: docker exec -i supabase-db psql -U postgres -d postgres < restore_user.sql

-- Шаг 1: Убедимся что расширение pgcrypto установлено
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Шаг 2: Проверяем, сколько пользователей в auth.users
SELECT 
  COUNT(*) as total_users,
  COUNT(CASE WHEN email = 'Bahtin106@gmail.com' THEN 1 END) as bahtin_exists
FROM auth.users;

-- Шаг 3: Если пользователя нет, вставляем его
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  is_sso_user,
  phone,
  phone_confirmed_at,
  confirmation_sent_at,
  email_change,
  email_change_token_new,
  email_change_token_old,
  email_change_confirm_token,
  banned_until,
  reauthentication_token,
  reauthentication_sent_at,
  recovery_token,
  recovery_sent_at,
  deleted_at
)
SELECT
  gen_random_uuid()::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated'::text,
  'authenticated'::text,
  'Bahtin106@gmail.com'::citext,
  crypt('Bahtin106', gen_salt('bf'))::text,  -- ⚠️ ИЗМЕНИТЕ ПАРОЛЬ!
  NOW()::timestamp with time zone,
  NOW()::timestamp with time zone,
  NOW()::timestamp with time zone,
  NOW()::timestamp with time zone,
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"first_name":"Роман","last_name":"Бахтин"}'::jsonb,
  false::boolean,
  false::boolean,
  NULL::text,
  NULL::timestamp with time zone,
  NOW()::timestamp with time zone,
  NULL::citext,
  NULL::text,
  NULL::text,
  NULL::text,
  NULL::timestamp with time zone,
  NULL::text,
  NULL::timestamp with time zone,
  NULL::text,
  NULL::timestamp with time zone,
  NULL::timestamp with time zone
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'Bahtin106@gmail.com'
);

-- Шаг 4: Проверяем результат
SELECT id, email, email_confirmed_at, raw_user_meta_data 
FROM auth.users 
WHERE email = 'Bahtin106@gmail.com';

-- Шаг 5: Если у вас есть таблица profiles, можем синхронизировать
-- (если её структура отличается, адаптируйте поля)
INSERT INTO public.profiles (
  id,
  email,
  first_name,
  last_name,
  created_at,
  updated_at
)
SELECT
  id,
  email,
  raw_user_meta_data->>'first_name',
  raw_user_meta_data->>'last_name',
  NOW(),
  NOW()
FROM auth.users
WHERE email = 'Bahtin106@gmail.com'
AND NOT EXISTS (
  SELECT 1 FROM public.profiles 
  WHERE email = 'Bahtin106@gmail.com'
)
ON CONFLICT (id) DO NOTHING;

-- ===================================================================
-- ГОТОВО! Попробуйте войти с email: Bahtin106@gmail.com
-- ===================================================================
