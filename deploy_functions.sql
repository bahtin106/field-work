-- Создание Edge Functions через SQL
-- Эти функции будут вызываться через RPC

-- Удаляем старые версии функций
DROP FUNCTION IF EXISTS public.invite_user(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, UUID);
DROP FUNCTION IF EXISTS public.invite_user(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.invite_user(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_set_user_password(UUID, TEXT);

-- 1. Функция проверки заявок сотрудника
CREATE OR REPLACE FUNCTION public.check_employee_orders(employee_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active_count INTEGER;
  available_employees JSON;
  result JSON;
BEGIN
  -- Проверка прав доступа (только admin и dispatcher)
  IF NOT (
    SELECT role IN ('admin', 'dispatcher') 
    FROM profiles 
    WHERE id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied. Only admins and dispatchers can check employee orders.'
      USING HINT = 'Requires admin or dispatcher role';
  END IF;

  -- Подсчет активных заявок
  SELECT COUNT(*)
  INTO active_count
  FROM orders
  WHERE assigned_to = employee_id
    AND status NOT IN ('completed', 'cancelled');

  -- Получение доступных сотрудников для переназначения
  SELECT json_agg(
    json_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'role', p.role
    )
  )
  INTO available_employees
  FROM profiles p
  WHERE p.company_id = (
    SELECT company_id 
    FROM profiles 
    WHERE id = employee_id
  )
  AND p.id != employee_id
  AND p.role IN ('worker', 'admin', 'dispatcher')
  AND (p.is_suspended IS NULL OR p.is_suspended = false);

  -- Формирование результата
  result := json_build_object(
    'activeOrdersCount', active_count,
    'availableEmployees', COALESCE(available_employees, '[]'::json)
  );

  RETURN result;
END;
$$;

-- 2. Функция деактивации сотрудника
CREATE OR REPLACE FUNCTION public.deactivate_employee(
  employee_id UUID,
  reassign_to UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID;
  current_user_role TEXT;
  employee_company_id UUID;
  result JSON;
BEGIN
  -- Получение текущего пользователя
  current_user_id := auth.uid();
  
  -- Проверка прав доступа (только admin)
  SELECT role 
  INTO current_user_role
  FROM profiles 
  WHERE id = current_user_id;

  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Only admins can deactivate employees.'
      USING HINT = 'Requires admin role';
  END IF;

  -- Проверка самодеактивации
  IF employee_id = current_user_id THEN
    RAISE EXCEPTION 'Cannot deactivate yourself'
      USING HINT = 'Admin cannot deactivate their own account';
  END IF;

  -- Получение company_id сотрудника и проверка существования
  SELECT company_id 
  INTO employee_company_id
  FROM profiles 
  WHERE id = employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found'
      USING HINT = 'No profile found with the given ID';
  END IF;

  -- Проверка принадлежности к одной компании
  IF employee_company_id != (SELECT company_id FROM profiles WHERE id = current_user_id) THEN
    RAISE EXCEPTION 'Cannot deactivate employee from different company'
      USING HINT = 'Employee must belong to the same company';
  END IF;

  -- Переназначение заявок, если указан reassign_to
  IF reassign_to IS NOT NULL THEN
    UPDATE orders
    SET assigned_to = reassign_to,
        updated_at = now()
    WHERE assigned_to = employee_id
      AND status NOT IN ('completed', 'cancelled');
  END IF;

  -- УДАЛЕНИЕ связанных данных в правильном порядке
  -- 1. Удалить auth.identities (иначе останутся orphaned записи)
  DELETE FROM auth.identities WHERE user_id = employee_id;

  -- 2. Удалить профиль
  DELETE FROM profiles WHERE id = employee_id;

  -- 3. Удалить пользователя из auth.users
  DELETE FROM auth.users WHERE id = employee_id;

  -- Формирование результата
  result := json_build_object(
    'success', true,
    'message', 'Employee deleted successfully'
  );

  RETURN result;
END;
$$;

-- Предоставление прав на выполнение функций
GRANT EXECUTE ON FUNCTION public.check_employee_orders(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_employee(UUID, UUID) TO authenticated;

-- 3. Функция приглашения нового пользователя
-- Создает только профиль, сам пользователь должен быть создан через Supabase Admin API
CREATE OR REPLACE FUNCTION public.invite_user(
  p_email TEXT,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_full_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_birthdate DATE DEFAULT NULL,
  p_role TEXT DEFAULT 'worker',
  p_department_id UUID DEFAULT NULL,
  p_temp_password TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID;
  current_user_role TEXT;
  current_company_id UUID;
  email_lower TEXT;
  existing_user UUID;
  result JSON;
BEGIN
  -- Получение текущего пользователя
  current_user_id := auth.uid();
  
  -- Проверка прав доступа (admin или dispatcher)
  SELECT p.role, p.company_id
  INTO current_user_role, current_company_id
  FROM profiles p
  WHERE p.id = current_user_id;

  IF current_user_role NOT IN ('admin', 'dispatcher') THEN
    RAISE EXCEPTION 'Forbidden: only admin/dispatcher can invite users'
      USING HINT = 'Requires admin or dispatcher role';
  END IF;

  -- Валидация email
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'email is required'
      USING HINT = 'Email cannot be empty';
  END IF;

  -- Валидация user_id
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required'
      USING HINT = 'User must be created via Admin API first';
  END IF;

  email_lower := lower(trim(p_email));

  -- Проверка существующего профиля (не проверяем auth.users, так как проверка уже произошла в Admin API)
  SELECT p.id INTO existing_user
  FROM profiles p
  WHERE p.id = p_user_id
  LIMIT 1;

  IF existing_user IS NOT NULL THEN
    -- Профиль уже существует для этого user_id, просто возвращаем успех
    result := jsonb_build_object(
      'user_id', p_user_id,
      'email', email_lower,
      'message', 'Profile already exists'
    );
    RETURN result;
  END IF;

  -- Создание профиля для уже созданного пользователя
  INSERT INTO profiles (
    id,
    email,
    first_name,
    last_name,
    full_name,
    phone,
    birthdate,
    role,
    company_id,
    department_id,
    created_at,
    updated_at
  ) VALUES (
    p_user_id,
    email_lower,
    p_first_name,
    p_last_name,
    COALESCE(p_full_name, trim(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''))),
    p_phone,
    p_birthdate,
    p_role,
    current_company_id,
    p_department_id,
    now(),
    now()
  );

  -- Формирование результата
  result := jsonb_build_object(
    'user_id', p_user_id,
    'email', email_lower,
    'message', 'Profile created successfully'
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.invite_user(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, UUID, TEXT, UUID) TO authenticated;

-- Комментарии для документации
COMMENT ON FUNCTION public.check_employee_orders(UUID) IS 
'Проверяет активные заявки сотрудника и возвращает список доступных сотрудников для переназначения. Доступно только admin и dispatcher.';

COMMENT ON FUNCTION public.deactivate_employee(UUID, UUID) IS 
'Деактивирует сотрудника и опционально переназначает его активные заявки. Полностью удаляет пользователя из auth.identities, profiles и auth.users. Доступно только admin.';

COMMENT ON FUNCTION public.invite_user(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, UUID, TEXT, UUID) IS 
'Создает профиль для пользователя. Пользователь должен быть создан через Admin.inviteUserByEmail перед вызовом этой функции. Доступно только admin и dispatcher.';
