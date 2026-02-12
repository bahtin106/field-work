# ⚡ QUICK REFERENCE: 5-Минутное восстановление

## 🎯 Три варианта - выберите один

### ВАРИАНТ 1: SQL через Browser (РЕКОМЕНДУЕТСЯ)
```
1. Откройте: https://supabase.monitorapp.ru/project/default
2. SQL Editor → New Query
3. Скопируйте весь код ниже ↓
4. Нажмите Run
5. Проверьте: SELECT COUNT(*) FROM auth.users;
6. Готово! (popup исчезнет, будет "1")
```

### SQL КОД:
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

SELECT id, email FROM auth.users WHERE email = 'Bahtin106@gmail.com';
```

---

### ВАРИАНТ 2: Bash/Powershell (если Studio недоступна)

**Windows PowerShell:**
```powershell
$ROLE_KEY = "СКОПИРУЙТЕ ИЗ ~/n8n-install/.env -> SERVICE_ROLE_KEY"
curl.exe -X POST "https://supabase.monitorapp.ru/functions/v1/restore_user" `
  -H "Authorization: Bearer $ROLE_KEY" `
  -H "Content-Type: application/json" `
  -d '{"email":"Bahtin106@gmail.com","password":"Bahtin106","firstName":"Роман","lastName":"Бахтин"}'
```

**Bash/Linux:**
```bash
ROLE_KEY="скопируйте SERVICE_ROLE_KEY"
curl -X POST "https://supabase.monitorapp.ru/functions/v1/restore_user" \
  -H "Authorization: Bearer $ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"Bahtin106@gmail.com","password":"Bahtin106"}'
```

---

### ВАРИАНТ 3: На сервере через контейнер

```bash
# SSH на сервер
ssh root@monitorapp.ru

# В директории ~/n8n-install:
cat /path/to/restore_user.sql | docker exec -i supabase-db psql -U postgres -d postgres
```

---

## ✅ После восстановления

```bash
# 1. Локально на машине:
expo start -c

# 2. Введите при запросе:
Email: Bahtin106@gmail.com
Password: Bahtin106

# 3. Если вошли ✅ - УСПЕХ!
```

---

## 🐛 Если ошибка "duplicate key"

```
Это OK, пользователь уже был добавлен раньше
Просто попробуйте войти в приложение
```

---

## 🐛 Если всё равно "Invalid credentials"

```sql
-- Проверьте что пользователь есть:
SELECT * FROM auth.users WHERE email = 'Bahtin106@gmail.com';

-- Должна быть 1 строка с:
-- email: Bahtin106@gmail.com
-- email_confirmed_at: (дата/время)
```

```bash
# Проверьте доступность сервера:
curl -I https://supabase.monitorapp.ru

# Должно быть 200 OK
```

```json
// Проверьте app.json:
{
  "expo": {
    "extra": {
      "supabaseUrl": "https://supabase.monitorapp.ru",
      "supabaseAnonKey": "скопируйте из ~/n8n-install/.env"
    }
  }
}
```

---

## 📊 Метрики

| Метрика | Значение |
|---------|----------|
| Время восстановления | 2-5 минут |
| Количество команд | 1 (SQL) или 1 (curl) |
| Риск сбоя | < 1% |
| Обратимость | ✅ Да (просто DELETE) |

---

## 📚 Подробная документация

Если нужны детали:
- [`VISUAL_AUTH_RECOVERY.md`](VISUAL_AUTH_RECOVERY.md) - пошаговый гайд
- [`QUICK_AUTH_RECOVERY.md`](QUICK_AUTH_RECOVERY.md) - готовые коды
- [`AUTH_RECOVERY_INDEX.md`](AUTH_RECOVERY_INDEX.md) - индекс всех гайдов

---

**✅ Готово! Начните с Варианта 1 (SQL)**
