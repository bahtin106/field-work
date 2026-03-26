-- Backup app_company_settings
CREATE TABLE IF NOT EXISTS public.app_company_settings_backup (LIKE public.app_company_settings INCLUDING ALL);

INSERT INTO public.app_company_settings_backup
SELECT * FROM public.app_company_settings;

-- Verify counts
SELECT
  (SELECT count(*) FROM public.app_company_settings) AS original_count,
  (SELECT count(*) FROM public.app_company_settings_backup) AS backup_count;

-- Show backup table existence
SELECT to_regclass('public.app_company_settings_backup') AS backup_exists;
