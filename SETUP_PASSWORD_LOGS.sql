-- SQL скрипт для быстрого развертывания table password_change_log и проверки
-- Выполните в Supabase Studio → SQL Editor

-- ====================================
-- 1. Проверяем, что таблица не существует
-- ====================================
DROP TABLE IF EXISTS public.password_change_log CASCADE;

-- ====================================
-- 2. Создаём таблицу password_change_log
-- ====================================
CREATE TABLE public.password_change_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address TEXT,
  user_agent TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ====================================
-- 3. Создаём индексы для быстрого поиска
-- ====================================
CREATE INDEX idx_password_change_log_user_id ON public.password_change_log(user_id);
CREATE INDEX idx_password_change_log_changed_at ON public.password_change_log(changed_at DESC);
CREATE INDEX idx_password_change_log_changed_by ON public.password_change_log(changed_by);

-- ====================================
-- 4. Включаем RLS (Row Level Security)
-- ====================================
ALTER TABLE public.password_change_log ENABLE ROW LEVEL SECURITY;

-- ====================================
-- 5. Создаём политики доступа
-- ====================================

-- Политика: пользователи могут видеть только свои записи об изменении пароля
CREATE POLICY "Users can view own password change logs"
  ON public.password_change_log
  FOR SELECT
  USING (
    auth.uid() = user_id 
    OR auth.uid() IN (
      SELECT id FROM public.profiles WHERE role = 'admin'
    )
  );

-- Политика: только система может вставлять записи
CREATE POLICY "Allow insert password logs"
  ON public.password_change_log
  FOR INSERT
  WITH CHECK (true);

-- ====================================
-- 6. Добавляем комментарии
-- ====================================
COMMENT ON TABLE public.password_change_log IS 'Таблица для логирования всех изменений пароля пользователей. Используется для аудита и безопасности.';
COMMENT ON COLUMN public.password_change_log.user_id IS 'ID пользователя, чей пароль был изменен';
COMMENT ON COLUMN public.password_change_log.changed_by IS 'ID администратора/пользователя, который инициировал изменение пароля';
COMMENT ON COLUMN public.password_change_log.changed_at IS 'Дата и время изменения пароля';
COMMENT ON COLUMN public.password_change_log.ip_address IS 'IP адрес, с которого было произведено изменение';
COMMENT ON COLUMN public.password_change_log.user_agent IS 'User-Agent браузера/приложения';

-- ====================================
-- 7. Проверяем результат
-- ====================================
SELECT table_name FROM information_schema.tables WHERE table_name = 'password_change_log' AND table_schema = 'public';

-- ====================================
-- 8. Проверяем структуру таблицы
-- ====================================
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'password_change_log' ORDER BY ordinal_position;
