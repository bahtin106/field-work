# Инструкция по развертыванию Edge Function для регистрации

## Обзор

Была создана новая Edge Function `register_user` для регистрации первых пользователей новых компаний.

## Что было сделано

### 1. Создан файл функции

- **Путь**: `supabase/functions/register_user/index.ts`
- **Функция**: Обрабатывает регистрацию нового пользователя с возможностью создания компании

### 2. Создана страница регистрации

- **Путь**: `app/(auth)/register.jsx`
- **Функции**:
  - Форма регистрации с валидацией
  - Выбор типа аккаунта (solo/компания)
  - Загрузка аватара
  - Автоматический вход после регистрации

### 3. Обновлены переводы

- Добавлены все необходимые ключи в `src/i18n/ru.js`

### 4. Обновлен роутинг

- Auth layout теперь поддерживает роут `/register`
- Добавлена ссылка на регистрацию на странице логина

## Развертывание Edge Function

### Шаг 1: Проверьте конфигурацию Supabase CLI

Убедитесь, что у вас установлен Supabase CLI:

```bash
# Установка (если еще не установлено)
npm install -g supabase

# Проверка версии
supabase --version
```

### Шаг 2: Войдите в Supabase

```bash
supabase login
```

### Шаг 3: Свяжите проект

```bash
# Если еще не связано
supabase link --project-ref <your-project-ref>
```

### Шаг 4: Разверните функцию

```bash
# Из корневой директории проекта
supabase functions deploy register_user
```

### Шаг 5: Проверьте развертывание

После развертывания функция будет доступна по URL:

```
https://<your-project-ref>.supabase.co/functions/v1/register_user
```

## Проверка работы

### Тест через curl:

```bash
curl -X POST https://<your-project-ref>.supabase.co/functions/v1/register_user \
  -H "Content-Type: application/json" \
  -H "apikey: <your-anon-key>" \
  -d '{
    "email": "test@example.com",
    "password": "test12345",
    "first_name": "Иван",
    "last_name": "Петров",
    "full_name": "Иван Петров",
    "account_type": "company",
    "company_name": "ООО Тестовая"
  }'
```

Ожидаемый ответ (успех):

```json
{
  "user_id": "uuid-здесь",
  "company_id": "uuid-здесь-или-null",
  "success": true
}
```

## Требования к базе данных

Убедитесь, что в вашей БД есть следующие таблицы:

### 1. Таблица `companies`

```sql
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. Таблица `profiles`

Должна поддерживать следующие поля:

- `id` (UUID, связь с auth.users)
- `email` (TEXT)
- `role` (TEXT)
- `first_name` (TEXT)
- `last_name` (TEXT)
- `full_name` (TEXT)
- `phone` (TEXT, опционально)
- `birthdate` (DATE, опционально)
- `company_id` (UUID, опционально, связь с companies)
- `avatar_url` (TEXT, опционально)

## Безопасность

1. **Функция доступна без авторизации** - это нормально для регистрации
2. **Валидация данных** происходит на стороне функции
3. **Email проверяется на уникальность** перед созданием
4. **Первый пользователь всегда получает роль `admin`**

## Troubleshooting

### Ошибка: "Project not linked"

```bash
supabase link --project-ref <your-project-ref>
```

### Ошибка: "Permission denied"

Проверьте права доступа SERVICE_ROLE_KEY в настройках проекта

### Функция не вызывается

- Проверьте, что в `.env` правильно указан `EXPO_PUBLIC_SUPABASE_URL`
- Проверьте, что функция развернута: `supabase functions list`

## Переменные окружения

Убедитесь, что в `.env` есть:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## Интеграция с приложением

Edge Function автоматически интегрирована в:

- `app/(auth)/register.jsx` - страница регистрации
- Использует `FUNCTIONS.REGISTER_USER` из `lib/constants.js`

## Особенности реализации

### 1. Создание компании

- Если выбран тип "company", создается новая запись в таблице `companies`
- `company_id` автоматически привязывается к профилю пользователя

### 2. Solo аккаунт

- Если выбран тип "solo", компания не создается
- `company_id` остается `null` в профиле

### 3. Автоматический вход

- После успешной регистрации приложение пытается автоматически залогинить пользователя
- Если автовход не удался, пользователю предлагается войти вручную

### 4. Аватар

- Загрузка аватара происходит после создания профиля
- Использует существующую логику загрузки в storage

## Следующие шаги

1. Разверните функцию командой выше
2. Протестируйте регистрацию в приложении
3. Проверьте, что данные корректно сохраняются в БД
4. Убедитесь, что автоматический вход работает

## Дополнительная информация

- Edge Function написана на TypeScript
- Использует Supabase Admin Client для создания пользователя
- Включает транзакционный откат при ошибках
- Логирует все этапы для отладки
