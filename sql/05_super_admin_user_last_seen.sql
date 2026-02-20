-- sql/05_super_admin_user_last_seen.sql
-- Add last_seen_at to super-admin full user profile RPC.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_get_user_profile_full(uuid);

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
  suspended_at timestamptz,
  last_seen_at timestamptz
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
      p.suspended_at,
      p.last_seen_at
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
    s.suspended_at,
    s.last_seen_at
  FROM src s
  LEFT JOIN public.companies c ON c.id = s.company_id
  LEFT JOIN public.departments d ON d.id::text = s.department_id
  LEFT JOIN auth.users au ON au.id = s.user_id
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_user_profile_full(uuid) TO authenticated;

COMMIT;
