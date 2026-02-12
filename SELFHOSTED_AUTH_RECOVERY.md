# 🔧 Восстановление Auth в Self-Hosted Supabase

## Контекст
- **Cloud Supabase** (fopalcvzdkftsvhqszcx): пользователи + auth.users таблица
- **Self-Hosted Supabase** (~/n8n-install): только public schema перенеслась, auth.users пуста
- **Проблема**: auth.users не скопировалась из-за ошибок владения схемой при pg_dump

## ✅ Решение по шагам

### Шаг 1: Получить ANON_KEY и SERVICE_ROLE_KEY

На сервере в контейнере Supabase:

```bash
# SSH на сервер
ssh root@monitorapp.ru

# Перейдите в папку
cd ~/n8n-install

# Посмотрите .env
cat .env | grep -E "ANON_KEY|SERVICE_ROLE_KEY|JWT_SECRET"

# Скопируйте эти значения
```

Или через Supabase Studio:
1. Откройте https://supabase.monitorapp.ru/project/default
2. Settings → API → Copy ANON_KEY и SERVICE_ROLE_KEY

### Шаг 2: Развернуть Edge Function (Рекомендуется)

На своей локальной машине или на сервере:

```bash
# Если у вас есть Supabase CLI:
supabase link --project-ref default

# Деплой функции
supabase functions deploy restore_user --project-ref default
```

Или **вручную** через Supabase Studio:
1. Dashboard → Functions → Create new function
2. Назовите `restore_user`
3. Скопируйте содержимое из `supabase/functions/restore_user/index.ts`

### Шаг 3: Восстановить пользователя

**Вариант A: Через curl (Windows PowerShell или Git Bash)**

```powershell
$SUPABASE_URL = "https://supabase.monitorapp.ru"
$SERVICE_ROLE_KEY = "YOUR_SERVICE_ROLE_KEY_HERE"
$EMAIL = "Bahtin106@gmail.com"
$PASSWORD = "ваш_пароль"

$response = curl -X POST "$SUPABASE_URL/functions/v1/restore_user" `
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" `
  -H "Content-Type: application/json" `
  -d "{
    `"email`": `"$EMAIL`",
    `"password`": `"$PASSWORD`",
    `"firstName`": `"Роман`",
    `"lastName`": `"Бахтин`"
  }"

Write-Host $response
```

**Вариант B: Через Supabase Studio (SQL Editor)**

1. Откройте https://supabase.monitorapp.ru/project/default/editor
2. SQL Editor → New query
3. Выполните:

```sql
-- Проверяем, пуста ли auth.users
SELECT COUNT(*) FROM auth.users;

-- Если результат 0, добавляем пользователя
-- (если не 0, пользователи уже есть)

-- Вставляем нового пользователя
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  email_change_confirmed_at,
  created_at,
  updated_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  is_sso_user
) 
SELECT 
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'Bahtin106@gmail.com',
  crypt('ВашПароль', gen_salt('bf')),
  NOW(),
  NOW(),
  NOW(),
  NOW(),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"first_name":"Роман","last_name":"Бахтин"}'::jsonb,
  false,
  false
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'Bahtin106@gmail.com'
);
```

### Шаг 4: Проверить результат

```sql
-- Проверим, добавлен ли пользователь
SELECT id, email, email_confirmed_at FROM auth.users 
WHERE email = 'Bahtin106@gmail.com';
```

Если увидели строку - ✅ пользователь добавлен!

### Шаг 5: Попробовать войти

1. Откройте приложение (expo start)
2. Email: `Bahtin106@gmail.com`
3. Пароль: тот, что установили в Step 3

---

## 🐛 Если не работает

### Проблема: 401 Unauthorized при вызове функции

**Решение:**
```bash
# Убедитесь что используете SERVICE_ROLE_KEY, а не ANON_KEY
# SERVICE_ROLE_KEY должен быть длинный (~200+ символов)
```

### Проблема: "Function not found" при вызове restore_user

**Решение:**
1. Функция не развёрнута - разверните через Supabase CLI или Studio
2. Или используйте прямой SQL импорт (Step 3 - Вариант B)

### Проблема: "pgcrypto extension not found" при INSERT

**Решение:**
```sql
-- Включаем расширение
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Потом повторяем INSERT
```

### Проблема: Всё равно "Invalid credentials" при входе

**Проверьте:**
```bash
# 1. Пользователь существует?
curl -X GET "https://supabase.monitorapp.ru/auth/v1/verify?type=signup" \
  -H "apikey: YOUR_ANON_KEY"

# 2. JWT_SECRET совпадает?
cat ~/n8n-install/.env | grep JWT_SECRET

# 3. Попробуйте сбросить пароль через email
```

---

## 📋 Чек-лист

- [ ] Получили ANON_KEY и SERVICE_ROLE_KEY из ~/n8n-install/.env
- [ ] Развернули Edge Function `restore_user` (или готовы использовать SQL)
- [ ] Выполнили INSERT пользователя (через функцию или SQL)
- [ ] Проверили что пользователь добавился: `SELECT COUNT(*) FROM auth.users;`
- [ ] Попробовали войти в приложение
- [ ] Всё работает ✅

---

## 🆘 Если нужна помощь

Дайте мне:
1. Результат: `SELECT COUNT(*) FROM auth.users;`
2. Ошибку из логов приложения при попытке входа
3. Результат: `curl -I https://supabase.monitorapp.ru` (проверка доступности)
