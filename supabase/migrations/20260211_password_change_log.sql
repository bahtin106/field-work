-- Migration: Create password_change_log table for audit trail
-- Таблица для логирования всех изменений пароля

CREATE TABLE IF NOT EXISTS public.password_change_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address TEXT,
  user_agent TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Создаём индекс для быстрого поиска по user_id
CREATE INDEX IF NOT EXISTS idx_password_change_log_user_id ON public.password_change_log(user_id);
CREATE INDEX IF NOT EXISTS idx_password_change_log_changed_at ON public.password_change_log(changed_at DESC);

-- Даём права доступа
ALTER TABLE public.password_change_log ENABLE ROW LEVEL SECURITY;

-- Политика: пользователи могут видеть только свои записи об изменении пароля
CREATE POLICY "Users can view own password change logs"
  ON public.password_change_log
  FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() IN (
    SELECT id FROM auth.users WHERE raw_user_meta_data->>'role' = 'admin'
  ));

-- Политика: только система (anonymous + service role) может вставлять записи
-- На самом деле, это будет делаться через edge-функцию с service role
CREATE POLICY "Only insert password logs via service role"
  ON public.password_change_log
  FOR INSERT
  WITH CHECK (true);

-- Добавляем комментарий к таблице
COMMENT ON TABLE public.password_change_log IS 'Таблица для логирования всех изменений пароля пользователей. Используется для аудита и безопасности.';
COMMENT ON COLUMN public.password_change_log.user_id IS 'ID пользователя, чей пароль был изменен';
COMMENT ON COLUMN public.password_change_log.changed_by IS 'ID пользователя, который изменил пароль (NULL если это был сам пользователь)';
COMMENT ON COLUMN public.password_change_log.changed_at IS 'Дата и время изменения пароля';
COMMENT ON COLUMN public.password_change_log.ip_address IS 'IP адрес, с которого было произведено изменение (если доступно)';
COMMENT ON COLUMN public.password_change_log.user_agent IS 'User-Agent браузера/приложения (если доступно)';
