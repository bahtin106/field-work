# СРОЧНОЕ РЕШЕНИЕ: Очистка orphaned auth.users и разблокировка создания пользователей

## Проблема
```
ERROR [handleInviteConfirm] CreateUser error: [AuthApiError: Database error checking email]
```

**Причина:** В auth.users остались orphaned/corrupted записи старых пользователей, которые блокируют создание новых с тем же email.

---

## РЕШЕНИЕ: Выполнить очистку в Supabase SQL Editor

1. **Откройте Supabase Dashboard** → supabase.monitorapp.ru
2. **SQL Editor** (слева внизу)
3. **Создайте новый запрос** (+ кнопка)
4. **Скопируйте и выполните этот скрипт:**

```sql
-- STEP 1: Найти orphaned users (users без профилей)
SELECT 
  au.id,
  au.email,
  au.created_at,
  CASE WHEN p.id IS NULL THEN 'ORPHANED - DELETE ME' ELSE 'has profile' END as status
FROM auth.users au
LEFT JOIN public.profiles p ON au.id = p.id
WHERE p.id IS NULL
ORDER BY au.created_at DESC
LIMIT 20;
```

5. **Посмотрите результаты** — это users которые нужно удалить. Если в status стоит "ORPHANED - DELETE ME" — это те что мешают.

6. **Удалить orphaned users:**

```sql
DELETE FROM auth.users 
WHERE id IN (
  SELECT au.id
  FROM auth.users au
  LEFT JOIN public.profiles p ON au.id = p.id
  WHERE p.id IS NULL
);
```

7. **Проверить результат:**

```sql
-- Должно вернуть 0 или очень мало
SELECT COUNT(*) as orphaned_count FROM auth.users au
LEFT JOIN public.profiles p ON au.id = p.id
WHERE p.id IS NULL;
```

---

## ВАЖНО: Проверить дубли по email в auth.users

Если проблема персистирует, могут быть **дубли одного email в auth.users**:

```sql
-- Смотреть дубли
SELECT email, COUNT(*) as count
FROM auth.users
WHERE email IS NOT NULL
GROUP BY email
HAVING COUNT(*) > 1;
```

**Если есть дубли** — удалить старые (оставить новые):

```sql
DELETE FROM auth.users au1
WHERE id IN (
  SELECT au2.id
  FROM auth.users au2
  INNER JOIN (
    SELECT email, MAX(created_at) as latest
    FROM auth.users
    WHERE email IS NOT NULL
    GROUP BY email
    HAVING COUNT(*) > 1
  ) dupes ON au2.email = dupes.email AND au2.created_at < dupes.latest
);
```

---

## После очистки

1. **Повторить создание пользователя** через приложение
2. Если всё ещё ошибка — проверить логи суппорта Supabase (Authentication → Logs)

---

## Долгосрочное решение

Изменить `deactivate_employee` функцию — **не удалять из auth.users**, а **отключать пользователя**:

```sql
-- Вместо DELETE, используй UPDATE с отключением:
UPDATE auth.users 
SET email_confirmed_at = NULL,
    deleted_at = NOW(),
    is_sso_user = FALSE
WHERE id = employee_id;
```

Это оставит запись, но отключит доступ, не создавая orphaned records.

---

## Чек-лист

- [ ] Выполнено Step 1 (найти orphaned)
- [ ] Выполнено Step 2-3 (удалить orphaned)
- [ ] Проверено 0 orphaned в результате
- [ ] Проверено нет дублей по email
- [ ] Повторное создание пользователя работает ✓
