-- sql/04_super_admin_user_unification.sql
-- Shared user profile RPCs for super-admin access from common user pages.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_user_profile_full(p_profile_id uuid)
RETURNS TABLE(
  profile_id uuid,
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  full_name text,
  role text,
  company_id uuid,
  company_name text,
  phone text,
  birthdate date,
  avatar_url text,
  department_id text,
  department_name text,
  is_suspended boolean,
  suspended_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_assert_super_admin();

  RETURN QUERY
  WITH src AS (
    SELECT
      p.id AS profile_id,
      CASE
        WHEN (to_jsonb(p)->>'user_id') ~* '^[0-9a-f-]{36}$' THEN (to_jsonb(p)->>'user_id')::uuid
        ELSE p.id
      END AS user_id,
      p.email AS profile_email,
      p.first_name,
      p.last_name,
      p.full_name,
      p.role,
      p.company_id,
      p.phone,
      p.birthdate,
      p.avatar_url,
      p.department_id::text AS department_id,
      p.is_suspended,
      p.suspended_at
    FROM public.profiles p
    WHERE p.id = p_profile_id
    LIMIT 1
  )
  SELECT
    s.profile_id,
    s.user_id,
    COALESCE(s.profile_email, au.email) AS email,
    s.first_name,
    s.last_name,
    s.full_name,
    s.role,
    s.company_id,
    c.name AS company_name,
    s.phone,
    s.birthdate,
    s.avatar_url,
    s.department_id,
    d.name AS department_name,
    COALESCE(s.is_suspended, false) AS is_suspended,
    s.suspended_at
  FROM src s
  LEFT JOIN public.companies c ON c.id = s.company_id
  LEFT JOIN public.departments d ON d.id::text = s.department_id
  LEFT JOIN auth.users au ON au.id = s.user_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_profile_super_full(
  p_profile_id uuid,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_birthdate date DEFAULT NULL,
  p_department_id text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_is_suspended boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_name text;
  v_last_name text;
  v_role text;
  v_company_id uuid;
  v_full_name text;
  v_department_col_type text;
BEGIN
  PERFORM public.admin_assert_super_admin();

  IF p_role IS NOT NULL AND lower(p_role) NOT IN ('admin', 'dispatcher', 'worker') THEN
    RAISE EXCEPTION 'unsupported role: %', p_role;
  END IF;

  SELECT first_name, last_name, role, company_id
  INTO v_first_name, v_last_name, v_role, v_company_id
  FROM public.profiles
  WHERE id = p_profile_id
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'profile not found: %', p_profile_id;
  END IF;

  v_first_name := COALESCE(p_first_name, v_first_name);
  v_last_name := COALESCE(p_last_name, v_last_name);
  v_role := COALESCE(p_role, v_role);
  v_company_id := COALESCE(p_company_id, v_company_id);
  v_full_name := NULLIF(trim(concat_ws(' ', v_first_name, v_last_name)), '');

  UPDATE public.profiles
  SET
    first_name = v_first_name,
    last_name = v_last_name,
    full_name = v_full_name,
    role = v_role,
    company_id = v_company_id
  WHERE id = p_profile_id;

  IF p_phone IS NOT NULL THEN
    UPDATE public.profiles
    SET phone = NULLIF(trim(p_phone), '')
    WHERE id = p_profile_id;
  END IF;

  IF p_birthdate IS NOT NULL THEN
    UPDATE public.profiles
    SET birthdate = p_birthdate
    WHERE id = p_profile_id;
  END IF;

  IF p_avatar_url IS NOT NULL THEN
    UPDATE public.profiles
    SET avatar_url = NULLIF(trim(p_avatar_url), '')
    WHERE id = p_profile_id;
  END IF;

  IF p_department_id IS NOT NULL THEN
    SELECT format_type(a.atttypid, a.atttypmod)
    INTO v_department_col_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'profiles'
      AND a.attname = 'department_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
    LIMIT 1;

    IF v_department_col_type IS NOT NULL THEN
      EXECUTE format(
        'UPDATE public.profiles SET department_id = NULLIF($1, '''')::%s WHERE id = $2',
        v_department_col_type
      )
      USING p_department_id, p_profile_id;
    END IF;
  END IF;

  IF p_is_suspended IS NOT NULL THEN
    UPDATE public.profiles
    SET
      is_suspended = p_is_suspended,
      suspended_at = CASE WHEN p_is_suspended THEN now() ELSE NULL END
    WHERE id = p_profile_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'profile_id', p_profile_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_user_profile_full(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_profile_super_full(uuid, text, text, text, uuid, text, date, text, text, boolean) TO authenticated;

COMMIT;
