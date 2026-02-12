# ⚡ БЫСТРОЕ ВОССТАНОВЛЕНИЕ ДОСТУПА (3-5 минут)

## Что произошло?
Self-hosted Supabase был установлен, данные public schema перенесены из Cloud, но **auth.users таблица пуста** (пользователи не скопировались).

## Решение: 2 варианта на выбор

### ✅ ВАРИАНТ 1: SQL (Самый быстрый)

**На сервере или локально:**

1. **Откройте Supabase Studio:**
   ```
   https://supabase.monitorapp.ru/project/default
   ```

2. **SQL Editor → New Query**

3. **Копируйте и выполняйте:**
   ```sql
   -- Включаем расширение
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   
   -- Вставляем пользователя
   INSERT INTO auth.users (
     id, instance_id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at, last_sign_in_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user,
     phone, phone_confirmed_at, confirmation_sent_at, email_change,
     email_change_token_new, email_change_token_old, email_change_confirm_token,
     banned_until, reauthentication_token, reauthentication_sent_at,
     recovery_token, recovery_sent_at, deleted_at
   )
   SELECT
     gen_random_uuid()::uuid,
     '00000000-0000-0000-0000-000000000000'::uuid,
     'authenticated'::text,
     'authenticated'::text,
     'Bahtin106@gmail.com'::citext,
     crypt('Bahtin106', gen_salt('bf'))::text,
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
   
   -- Проверяем
   SELECT id, email FROM auth.users WHERE email = 'Bahtin106@gmail.com';
   ```

4. **Результат:**
   - Если вы видите 1 строку ✅ - пользователь добавлен!
   - Если видите 0 - пользователь уже существует, переходите к Step 5

5. **Тестируйте приложение:**
   ```
   Email: Bahtin106@gmail.com
   Пароль: Bahtin106
   ```

---

### 🔧 ВАРИАНТ 2: Edge Function (Если SQL не сработает)

**На локальной машине:**

```bash
# 1. Развернуть функцию (требует Supabase CLI):
cd c:\Apps\field-work

supabase link --project-ref default

supabase functions deploy restore_user

# 2. Вызвать функцию:
$ROLE_KEY = "скопируйте SERVICE_ROLE_KEY из ~/n8n-install/.env"

$body = @{
    email = "Bahtin106@gmail.com"
    password = "Bahtin106"
    firstName = "Роман"
    lastName = "Бахтин"
} | ConvertTo-Json

curl.exe -X POST "https://supabase.monitorapp.ru/functions/v1/restore_user" `
  -H "Authorization: Bearer $ROLE_KEY" `
  -H "Content-Type: application/json" `
  -d $body
```

**Результат:**
```json
{
  "success": true,
  "message": "User Bahtin106@gmail.com restored successfully",
  "userId": "uuid-here"
}
```

---

## 🐛 Если не работает?

### "Invalid credentials" всё равно при входе
```sql
-- Проверяем что пользователь создался:
SELECT id, email, email_confirmed_at FROM auth.users;

-- Должна быть ровно 1 строка с Bahtin106@gmail.com
```

### "Permission denied" при INSERT
```sql
-- Включаем расширение и даём права:
CREATE EXTENSION IF NOT EXISTS pgcrypto;
GRANT ALL ON auth.users TO postgres;
```

### Функция не найдена (restore_user)
- Edge Function ещё не развёрнута, используйте **Вариант 1 (SQL)**

---

## 📋 Состояние до/после

| | До | После |
|---|---|---|
| **auth.users (пользователи)** | ❌ Пусто | ✅ Bahtin106@gmail.com добавлен |
| **public.profiles** | ✅ Есть данные | ✅ Синхронизировано с auth.users |
| **Вход в приложение** | ❌ "Invalid credentials" | ✅ Работает |

---

## 🚀 Готово!

После выполнения:
1. Очистите cache приложения
2. `expo start` на локальной машине
3. Введите email/пароль
4. ✅ Должны войти в приложение

**Если после этого работает - восстановление успешно!**
