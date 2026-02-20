-- sql/13_fix_admin_enforce_service_role.sql
-- Allow service_role to run admin_enforce_seat_limit in server/sql contexts.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_enforce_seat_limit(p_company_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN public.enforce_seat_limit(p_company_id);
  END IF;

  PERFORM public.admin_assert_super_admin();
  RETURN public.enforce_seat_limit(p_company_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_enforce_seat_limit(uuid) TO authenticated;

COMMIT;
