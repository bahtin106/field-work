-- supabase/migrations/20251215_trigger_sync_profiles_full_name.sql
-- Триггер поддерживает full_name автоматически на уровне базы.

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_profiles_full_name()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  combined TEXT;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.first_name IS DISTINCT FROM OLD.first_name OR NEW.last_name IS DISTINCT FROM OLD.last_name THEN
    combined := NULLIF(TRIM(CONCAT_WS(' ', NEW.first_name, NEW.last_name)), '');
    NEW.full_name := combined;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profiles_full_name_trigger ON public.profiles;

CREATE TRIGGER sync_profiles_full_name_trigger
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profiles_full_name();

COMMIT;
