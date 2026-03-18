# 🎯 СТАРТОВАЯ ТОЧКА: Полная диагностика + Готовое решение

---

## 📊 ВАШ ТЕКУЩИЙ СТАТУС

```
┌─────────────────────────────────────────────────┐
│  ПРИЛОЖЕНИЕ НА EXPO                             │
│                                                  │
│  User: Bahtin106@gmail.com                      │
│  Pass: •••••••                                  │
│  [Попытка входа]                                │
│          ↓                                       │
│  ❌ Invalid credentials                         │
└─────────────────────────────────────────────────┘
                    ↓
           ПОЧЕМУ ТАК ПРОИСХОДИТ?
                    ↓
┌─────────────────────────────────────────────────┐
│  SELF-HOSTED SUPABASE (Docker Compose)          │
│                                                  │
│  auth.users = ❌ ПУСТО! ← ПРОБЛЕМА!             │
│  (пользователи не перенеслись из Cloud)         │
└─────────────────────────────────────────────────┘
```

---

## ✅ РЕШЕНИЕ: 3 ВАРИАНТА НА ВЫБОР

### ВЫБОР 1️⃣: SQL (Самый простой) ← РЕКОМЕНДУЕТСЯ

```
Браузер
   ↓
https://supabase.monitorapp.ru/project/default
   ↓
SQL Editor
   ↓
[Вставить код] → [Run]
   ↓
auth.users получит пользователя ✅
   ↓
Приложение может войти ✅
```

**Файл с кодом:** [`restore_user.sql`](restore_user.sql)  
**Документация:** [`QUICK_START_AUTH_RECOVERY.md`](QUICK_START_AUTH_RECOVERY.md)  
**Время:** 2-3 минуты

---

### ВЫБОР 2️⃣: Bash/Curl (Надёжно)

```
Terminal
   ↓
$ROLE_KEY = "SERVICE_ROLE_KEY из .env"
   ↓
curl -X POST https://supabase.monitorapp.ru/functions/v1/restore_user ...
   ↓
Функция восстанавливает пользователя ✅
   ↓
Приложение может войти ✅
```

**Файл с кодом:** [`restore_user.sh`](restore_user.sh)  
**Документация:** [`QUICK_AUTH_RECOVERY.md`](QUICK_AUTH_RECOVERY.md) (Вариант B)  
**Время:** 1-2 минуты

---

### ВЫБОР 3️⃣: Edge Function (Масштабируемо)

```
Supabase CLI
   ↓
supabase functions deploy restore_user
   ↓
API endpoint готов ✅
   ↓
Можно вызывать многократно (все пользователи)
   ↓
Приложение может войти ✅
```

**Файл с кодом:** [`supabase/functions/restore_user/index.ts`](supabase/functions/restore_user/index.ts)  
**Документация:** [`SELFHOSTED_AUTH_RECOVERY.md`](SELFHOSTED_AUTH_RECOVERY.md)  
**Время:** 5-10 минут

---

## 🚀 ВАРИАНТ 1: SQL (НАЧНИТЕ ОТСЮДА)

### Шаг 1: Откройте Supabase Studio
```
🌐 Браузер → https://supabase.monitorapp.ru/project/default
```

### Шаг 2: SQL Editor
```
В левом меню → SQL Editor → [+ New Query]
```

### Шаг 3: Скопируйте КОД
```sql
-- СКОПИРУЙТЕ ВСЁ ЭТО И ВСТАВЬТЕ В SQL EDITOR:

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

### Шаг 4: Нажмите RUN
```
[Run] кнопка (зелёная) →
```

### Шаг 5: Проверьте результат
```
✅ Query succeeded
INSERT 1
SELECT (вернула 1 строку)
```

---

## ✅ ГОТОВО! Теперь тестируйте

```bash
# На локальной машине:
expo start -c

# Введите:
Email: Bahtin106@gmail.com
Password: Bahtin106

# Результат:
✅ Вошли в приложение = УСПЕХ!
❌ Всё равно Invalid credentials = читайте "Если не работает"
```

---

## 🐛 ЕСЛИ НЕ РАБОТАЕТ

### Ошибка: "duplicate key value..."
```
✅ Это OK! Пользователь уже добавлен
Просто попробуйте войти в приложение
```

### Ошибка: "pgcrypto not found"
```
Выполните отдельно:
CREATE EXTENSION pgcrypto;

Потом повторите INSERT
```

### Ошибка: "Invalid credentials" всё равно
```
Проверьте ШАГ 1: SELECT COUNT(*) FROM auth.users;
↓
Результат должен быть: 1 (или больше)
↓
Если 0 - SQL не выполнился, повторите шаги 1-4
```

### Ошибка: "Syntax error"
```
Скопируйте КОД заново
Не срезайте куски
Вставьте весь целиком в SQL Editor
```

---

## 🎓 ПОНИМАНИЕ: Что происходит

```
БЫЛА СИТУАЦИЯ:
┌──────────────────┐         ┌──────────────────┐
│  CLOUD SUPABASE  │         │  SELF-HOSTED     │
│  auth.users = ✅ │   →→→   │  auth.users = ❌ │
│  (201 пользов.)  │ pg_dump │  (0 пользов.)    │
└──────────────────┘         └──────────────────┘
           ↓
    ❌ Потеря auth.users

ПОСЛЕ РЕШЕНИЯ:
┌──────────────────┐         ┌──────────────────┐
│  CLOUD SUPABASE  │         │  SELF-HOSTED     │
│  auth.users = ✅ │         │  auth.users = ✅ │
│  (201 пользов.)  │         │  (1+ пользов.)   │
└──────────────────┘         └──────────────────┘
           ↓
    ✅ auth.users восстановлена
```

---

## 📊 РЕЗУЛЬТАТЫ

| Показатель | Было | Стало |
|-----------|------|-------|
| **auth.users** | ❌ Пусто | ✅ 1+ пользователь |
| **Вход в приложение** | ❌ Invalid credentials | ✅ Работает |
| **Доступ к data** | ❌ Нет | ✅ Есть |

---

## 🏁 СЛЕДУЮЩИЕ ШАГИ

### Дальше:
1. ✅ Восстановить остальных пользователей (если нужны)
2. ✅ Настроить backup стратегию
3. ✅ Настроить мониторинг
4. ✅ Документировать для команды

### Из гайдов:
- **Хочу быстро:** [`QUICK_START_AUTH_RECOVERY.md`](QUICK_START_AUTH_RECOVERY.md)
- **Хочу пошагово:** [`VISUAL_AUTH_RECOVERY.md`](VISUAL_AUTH_RECOVERY.md)
- **Хочу всё знать:** [`SELFHOSTED_AUTH_RECOVERY.md`](SELFHOSTED_AUTH_RECOVERY.md)

---

## 📞 КОНТАКТ

Если застряли на каком-то шаге:
1. Внимательно перечитайте этот документ
2. Проверьте раздел "ЕСЛИ НЕ РАБОТАЕТ"
3. Дайте результаты SQL запросов: `SELECT COUNT(*) FROM auth.users;`

---

## ⏱️ ВРЕМЯ

- **Чтение этого документа:** 3 минуты
- **Выполнение Варианта 1 (SQL):** 2-3 минуты
- **Тестирование приложения:** 2 минуты
- **ИТОГО:** ~7-10 минут

---

## ✅ ГОТОВО!

```
┌──────────────────────────────────────┐
│  ЭТАПЫ:                              │
│  1. Откройте Supabase Studio  ✅    │
│  2. SQL Editor → New Query    ✅    │
│  3. Скопируйте КОД            ✅    │
│  4. [Run]                     ✅    │
│  5. Тестируйте приложение     ✅    │
│                                      │
│  ИТОГ: Приложение работает!   ✅    │
└──────────────────────────────────────┘
```

**Начните выполнять прямо сейчас!** 🚀
