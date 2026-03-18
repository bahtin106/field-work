# Profile Loading Debug

## Проблема

Запросы к таблице `profiles` таймаутятся (15+ секунд), что говорит о проблеме на уровне БД.

## Возможные причины

### 1. RLS (Row Level Security) блокирует запросы

Проверь в Supabase Dashboard → Table Editor → profiles → Policies:

- Должна быть политика `SELECT` для `authenticated` пользователей
- Должна быть политика `INSERT` для создания собственного профиля

### 2. Отсутствуют индексы

Проверь в Supabase Dashboard → SQL Editor:

```sql
-- Проверить индексы
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'profiles';

-- Создать индекс если нужно
CREATE INDEX IF NOT EXISTS profiles_id_idx ON profiles(id);
```

### 3. Таймаут соединения

Возможно проблема с сетью или регион Supabase далеко.

## Временное решение

Можно полностью убрать загрузку профиля из БД и работать только с метаданными:

1. В `SimpleAuthProvider.jsx` закомментируй tryFetchProfile
2. Всегда возвращай `buildProfileFromUser(user, 'metadata')`
3. Храни роль/данные в `user.user_metadata` при регистрации

## SQL для проверки RLS

```sql
-- Посмотреть все политики
SELECT * FROM pg_policies WHERE tablename = 'profiles';

-- Включить RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Политика на чтение
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Политика на создание
CREATE POLICY "Users can create own profile"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- Политика на обновление
CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id);
```
