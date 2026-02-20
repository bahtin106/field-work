-- sql/03_super_admin_system.sql
-- Global super-admin layer + secure RPCs for cross-company administration.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.super_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,
  profile_id uuid UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT super_admins_identity_chk CHECK (user_id IS NOT NULL OR profile_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_super_admins_active_user ON public.super_admins (is_active, user_id);
CREATE INDEX IF NOT EXISTS idx_super_admins_active_profile ON public.super_admins (is_active, profile_id);

ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS super_admins_no_auth_access ON public.super_admins;
CREATE POLICY super_admins_no_auth_access
ON public.super_admins
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.super_admins sa
    WHERE sa.is_active = true
      AND (sa.user_id = v_uid OR sa.profile_id = v_uid)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assert_super_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'super-admin access required' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_super_admin(
  p_profile_id uuid,
  p_enabled boolean DEFAULT true,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile jsonb;
  v_user_id uuid;
BEGIN
  PERFORM public.admin_assert_super_admin();

  SELECT to_jsonb(p)
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_profile_id
  LIMIT 1;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'profile not found: %', p_profile_id;
  END IF;

  IF (v_profile->>'user_id') ~* '^[0-9a-f-]{36}$' THEN
    v_user_id := (v_profile->>'user_id')::uuid;
  ELSE
    v_user_id := p_profile_id;
  END IF;

  IF COALESCE(p_enabled, true) THEN
    INSERT INTO public.super_admins (user_id, profile_id, is_active, note, created_by)
    VALUES (v_user_id, p_profile_id, true, p_note, auth.uid())
    ON CONFLICT (profile_id)
    DO UPDATE SET
      user_id = EXCLUDED.user_id,
      is_active = true,
      note = EXCLUDED.note;
  ELSE
    UPDATE public.super_admins
    SET is_active = false,
        note = COALESCE(p_note, note)
    WHERE profile_id = p_profile_id OR user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'profile_id', p_profile_id, 'enabled', COALESCE(p_enabled, true));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_company_employees_count(p_company_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN 0;
  END IF;

  IF to_regclass('public.company_members') IS NOT NULL THEN
    EXECUTE $q$
      SELECT COUNT(*)::int
      FROM public.company_members cm
      WHERE cm.company_id = $1
        AND (cm.is_active IS NULL OR cm.is_active = true)
    $q$ INTO v_count USING p_company_id;
    RETURN COALESCE(v_count, 0);
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE $q$
      SELECT COUNT(*)::int
      FROM public.profiles p
      WHERE p.company_id = $1
    $q$ INTO v_count USING p_company_id;
    RETURN COALESCE(v_count, 0);
  END IF;

  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
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
  is_super_admin boolean,
  created_at timestamptz,
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
      NULLIF(to_jsonb(p)->>'created_at', '')::timestamptz AS created_at,
      NULLIF(to_jsonb(p)->>'last_seen_at', '')::timestamptz AS last_seen_at
    FROM public.profiles p
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
    EXISTS (
      SELECT 1
      FROM public.super_admins sa
      WHERE sa.is_active = true
        AND (sa.profile_id = s.profile_id OR sa.user_id = s.user_id)
    ) AS is_super_admin,
    s.created_at,
    s.last_seen_at
  FROM src s
  LEFT JOIN public.companies c ON c.id = s.company_id
  LEFT JOIN auth.users au ON au.id = s.user_id
  WHERE
    COALESCE(p_search, '') = ''
    OR COALESCE(s.full_name, '') ILIKE ('%' || p_search || '%')
    OR COALESCE(s.first_name, '') ILIKE ('%' || p_search || '%')
    OR COALESCE(s.last_name, '') ILIKE ('%' || p_search || '%')
    OR COALESCE(s.profile_email, au.email, '') ILIKE ('%' || p_search || '%')
    OR COALESCE(c.name, '') ILIKE ('%' || p_search || '%')
  ORDER BY COALESCE(s.full_name, s.profile_email, s.profile_id::text)
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_user(p_profile_id uuid)
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
  is_super_admin boolean,
  created_at timestamptz,
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
      NULLIF(to_jsonb(p)->>'created_at', '')::timestamptz AS created_at,
      NULLIF(to_jsonb(p)->>'last_seen_at', '')::timestamptz AS last_seen_at
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
    EXISTS (
      SELECT 1
      FROM public.super_admins sa
      WHERE sa.is_active = true
        AND (sa.profile_id = s.profile_id OR sa.user_id = s.user_id)
    ) AS is_super_admin,
    s.created_at,
    s.last_seen_at
  FROM src s
  LEFT JOIN public.companies c ON c.id = s.company_id
  LEFT JOIN auth.users au ON au.id = s.user_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_profile_super(
  p_profile_id uuid,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_is_super_admin boolean DEFAULT NULL
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
BEGIN
  PERFORM public.admin_assert_super_admin();

  IF p_role IS NOT NULL AND lower(p_role) NOT IN ('admin', 'dispatcher', 'worker') THEN
    RAISE EXCEPTION 'unsupported role: %', p_role;
  END IF;

  SELECT
    COALESCE(p_first_name, first_name),
    COALESCE(p_last_name, last_name),
    COALESCE(p_role, role),
    COALESCE(p_company_id, company_id)
  INTO v_first_name, v_last_name, v_role, v_company_id
  FROM public.profiles
  WHERE id = p_profile_id
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'profile not found: %', p_profile_id;
  END IF;

  v_full_name := trim(concat_ws(' ', v_first_name, v_last_name));

  UPDATE public.profiles
  SET
    first_name = v_first_name,
    last_name = v_last_name,
    full_name = NULLIF(v_full_name, ''),
    role = v_role,
    company_id = v_company_id
  WHERE id = p_profile_id;

  IF p_is_super_admin IS NOT NULL THEN
    PERFORM public.admin_set_super_admin(p_profile_id, p_is_super_admin, NULL);
  END IF;

  RETURN jsonb_build_object('ok', true, 'profile_id', p_profile_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_companies(
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  company_id uuid,
  name text,
  timezone text,
  currency text,
  employees_count int,
  plan_code text,
  subscription_status text,
  current_period_end timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_assert_super_admin();

  RETURN QUERY
  SELECT
    c.id AS company_id,
    c.name,
    c.timezone,
    c.currency,
    public.admin_company_employees_count(c.id) AS employees_count,
    bp.code AS plan_code,
    cs.status AS subscription_status,
    cs.current_period_end,
    c.updated_at
  FROM public.companies c
  LEFT JOIN public.company_subscriptions cs ON cs.company_id = c.id
  LEFT JOIN public.billing_plans bp ON bp.id = cs.plan_id
  WHERE
    COALESCE(p_search, '') = ''
    OR COALESCE(c.name, '') ILIKE ('%' || p_search || '%')
    OR c.id::text ILIKE ('%' || p_search || '%')
  ORDER BY COALESCE(c.name, c.id::text)
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_company(p_company_id uuid)
RETURNS TABLE(
  company_id uuid,
  name text,
  timezone text,
  currency text,
  employees_count int,
  plan_code text,
  subscription_status text,
  current_period_end timestamptz,
  grace_period_days int,
  extra_seats int,
  extra_storage_gb int,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_assert_super_admin();

  RETURN QUERY
  WITH addon_rows AS (
    SELECT ba.code, csa.quantity
    FROM public.company_subscriptions cs
    JOIN public.company_subscription_addons csa ON csa.subscription_id = cs.id
    JOIN public.billing_addons ba ON ba.id = csa.addon_id
    WHERE cs.company_id = p_company_id
  )
  SELECT
    c.id AS company_id,
    c.name,
    c.timezone,
    c.currency,
    public.admin_company_employees_count(c.id) AS employees_count,
    bp.code AS plan_code,
    cs.status AS subscription_status,
    cs.current_period_end,
    COALESCE(cs.grace_period_days, 0) AS grace_period_days,
    COALESCE((SELECT SUM(quantity)::int FROM addon_rows WHERE code = 'extra_seat'), 0) AS extra_seats,
    COALESCE((SELECT SUM(quantity)::int FROM addon_rows WHERE code = 'extra_storage_gb'), 0) AS extra_storage_gb,
    c.updated_at
  FROM public.companies c
  LEFT JOIN public.company_subscriptions cs ON cs.company_id = c.id
  LEFT JOIN public.billing_plans bp ON bp.id = cs.plan_id
  WHERE c.id = p_company_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_company_super(
  p_company_id uuid,
  p_name text DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_currency text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_assert_super_admin();

  UPDATE public.companies
  SET
    name = COALESCE(p_name, name),
    timezone = COALESCE(p_timezone, timezone),
    currency = COALESCE(p_currency, currency)
  WHERE id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'company not found: %', p_company_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'company_id', p_company_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_company_subscription_super(
  p_company_id uuid,
  p_plan_code text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_period_end timestamptz DEFAULT NULL,
  p_grace_period_days int DEFAULT NULL,
  p_extra_seats int DEFAULT NULL,
  p_extra_storage_gb int DEFAULT NULL
)
RETURNS public.company_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.company_subscriptions%ROWTYPE;
  v_plan_id uuid;
  v_status text;
  v_period_end timestamptz;
  v_grace int;
  v_sub public.company_subscriptions%ROWTYPE;
  v_addon_extra_seat uuid;
  v_addon_extra_storage uuid;
BEGIN
  PERFORM public.admin_assert_super_admin();

  IF p_status IS NOT NULL AND p_status NOT IN ('trial', 'active', 'past_due', 'canceled', 'paused') THEN
    RAISE EXCEPTION 'unsupported status: %', p_status;
  END IF;

  SELECT * INTO v_existing
  FROM public.company_subscriptions
  WHERE company_id = p_company_id
  LIMIT 1;

  IF p_plan_code IS NOT NULL THEN
    SELECT id INTO v_plan_id
    FROM public.billing_plans
    WHERE code = p_plan_code
    LIMIT 1;

    IF v_plan_id IS NULL THEN
      RAISE EXCEPTION 'plan code not found: %', p_plan_code;
    END IF;
  ELSE
    v_plan_id := v_existing.plan_id;
  END IF;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'plan is required for company %', p_company_id;
  END IF;

  v_status := COALESCE(p_status, v_existing.status, 'active');
  v_period_end := COALESCE(p_period_end, v_existing.current_period_end, now() + interval '30 days');
  v_grace := COALESCE(p_grace_period_days, v_existing.grace_period_days, 7);

  INSERT INTO public.company_subscriptions (
    company_id,
    plan_id,
    status,
    current_period_start,
    current_period_end,
    grace_period_days,
    source
  ) VALUES (
    p_company_id,
    v_plan_id,
    v_status,
    now(),
    v_period_end,
    v_grace,
    'admin'
  )
  ON CONFLICT (company_id)
  DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end,
    grace_period_days = EXCLUDED.grace_period_days,
    source = 'admin',
    updated_at = now()
  RETURNING * INTO v_sub;

  SELECT id INTO v_addon_extra_seat FROM public.billing_addons WHERE code = 'extra_seat' LIMIT 1;
  SELECT id INTO v_addon_extra_storage FROM public.billing_addons WHERE code = 'extra_storage_gb' LIMIT 1;

  IF v_addon_extra_seat IS NOT NULL THEN
    DELETE FROM public.company_subscription_addons
    WHERE subscription_id = v_sub.id
      AND addon_id = v_addon_extra_seat;

    IF COALESCE(p_extra_seats, 0) > 0 THEN
      INSERT INTO public.company_subscription_addons(subscription_id, addon_id, quantity)
      VALUES (v_sub.id, v_addon_extra_seat, p_extra_seats)
      ON CONFLICT (subscription_id, addon_id)
      DO UPDATE SET quantity = EXCLUDED.quantity;
    END IF;
  END IF;

  IF v_addon_extra_storage IS NOT NULL THEN
    DELETE FROM public.company_subscription_addons
    WHERE subscription_id = v_sub.id
      AND addon_id = v_addon_extra_storage;

    IF COALESCE(p_extra_storage_gb, 0) > 0 THEN
      INSERT INTO public.company_subscription_addons(subscription_id, addon_id, quantity)
      VALUES (v_sub.id, v_addon_extra_storage, p_extra_storage_gb)
      ON CONFLICT (subscription_id, addon_id)
      DO UPDATE SET quantity = EXCLUDED.quantity;
    END IF;
  END IF;

  RETURN v_sub;
END;
$$;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_profile_super(uuid, text, text, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_companies(text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_company_super(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_company_subscription_super(uuid, text, text, timestamptz, int, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_super_admin(uuid, boolean, text) TO authenticated;

-- Bootstrap current super-admin profile.
WITH preferred AS (
  SELECT p.*
  FROM public.profiles p
  WHERE p.id = '8b29d952-70fa-476b-baa5-140e1ae669e9'::uuid
  LIMIT 1
),
fallback_admin AS (
  SELECT p.*
  FROM public.profiles p
  WHERE lower(coalesce(p.role, '')) = 'admin'
  ORDER BY p.id
  LIMIT 1
),
chosen AS (
  SELECT * FROM preferred
  UNION ALL
  SELECT * FROM fallback_admin
  WHERE NOT EXISTS (SELECT 1 FROM preferred)
)
INSERT INTO public.super_admins (profile_id, user_id, is_active, note)
SELECT
  c.id,
  CASE
    WHEN (to_jsonb(c)->>'user_id') ~* '^[0-9a-f-]{36}$' THEN (to_jsonb(c)->>'user_id')::uuid
    ELSE c.id
  END,
  true,
  'Initial super-admin bootstrap'
FROM chosen c
ON CONFLICT (profile_id)
DO UPDATE SET
  is_active = true,
  user_id = EXCLUDED.user_id,
  note = EXCLUDED.note;

COMMIT;
