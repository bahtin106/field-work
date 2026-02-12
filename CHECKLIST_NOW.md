# ЧЕКЛИСТ: Что нужно сделать СЕЙЧАС

## ✅ Уже сделано:
1. Email-сервер на VPS работает (проверено)
2. Postfix настроен для relay от Docker
3. Код приложения обновлен на `inviteUserByEmail`
4. RPC функция `invite_user` готова
5. `supabaseServiceKey` добавлен в app.json

## 🔧 Что нужно сделать:

### 1. Очистить поврежденные данные в Supabase
**Откройте Supabase Dashboard → SQL Editor**

Выполните последовательно:

**a) Проверка (файл check_auth_users.sql):**
```sql
-- Проверяем проблемный email
SELECT id, email, created_at FROM auth.users 
WHERE email ILIKE 'expresspoliv@gmail.com';

-- Проверяем orphaned users
SELECT COUNT(*) FROM auth.users u
LEFT JOIN profiles p ON u.id = p.id
WHERE p.id IS NULL AND u.deleted_at IS NULL;
```

**b) Очистка (файл cleanup_auth_users.sql):**
```sql
-- Удаляем проблемный email
DELETE FROM auth.users 
WHERE email ILIKE 'expresspoliv@gmail.com'
  AND id NOT IN (SELECT id FROM profiles);

-- Удаляем orphaned users за последнюю неделю
DELETE FROM auth.users 
WHERE id NOT IN (SELECT id FROM profiles WHERE id IS NOT NULL)
  AND deleted_at IS NULL
  AND created_at > NOW() - INTERVAL '7 days';
```

**c) Обновление функций (файл deploy_functions.sql):**
- Скопируйте весь файл deploy_functions.sql
- Вставьте и выполните в SQL Editor

### 2. Перезапустить Expo
```powershell
npx expo start --clear
```

### 3. Перезапустить приложение на телефоне
- Полностью закройте приложение
- Откройте заново

### 4. Тестирование
Создайте нового пользователя:
- ✅ Email: используйте **НОВЫЙ** email (не expresspoliv@gmail.com)
- ✅ Заполните все поля
- ✅ Нажмите "Пригласить"

**Ожидаемый результат:**
- Нет ошибок в приложении
- Пользователь появился в списке
- Email с паролем пришел на почту

### 5. Проверка логов (если что-то не работает)

**Логи приложения:**
Смотрите в Metro bundler (терминал где `npx expo start`)

**Логи email-сервера:**
```powershell
ssh root@5.35.91.118 "docker logs --tail 30 email-server"
```

**Проверка Supabase:**
Supabase Dashboard → Logs → выберите Auth logs

## 🚨 Если ошибка повторяется:

1. Покажите точный текст ошибки
2. Скриншот из приложения
3. Вывод команды:
```powershell
ssh root@5.35.91.118 "docker logs --tail 50 email-server | grep -A 5 Error"
```

## 📝 Новый Flow (для справки):
1. Проверка email в profiles ✓
2. `inviteUserByEmail` - создание в auth.users ✓
3. `updateUserById` - установка пароля ✓
4. RPC `invite_user` - создание профиля ✓
5. Email-сервер - отправка пароля ✓

## ⚡ Быстрый тест email (без создания пользователя):
```powershell
ssh root@5.35.91.118 'curl -s -X POST http://localhost:3000/send-email -H "Content-Type: application/json" -d "{\"type\":\"invite\",\"email\":\"YOUR_EMAIL@gmail.com\",\"firstName\":\"Test\",\"lastName\":\"User\",\"tempPassword\":\"Test123!\"}"'
```

Если письмо пришло - email-сервер работает ✅
