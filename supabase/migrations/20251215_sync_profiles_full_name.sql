-- supabase/migrations/20251215_sync_profiles_full_name.sql
-- Обновляет поле full_name, если имя или фамилия заданы, но full_name пустой/содержит email.

BEGIN;

UPDATE public.profiles
SET full_name = NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '')
WHERE (first_name IS NOT NULL OR last_name IS NOT NULL)
  AND (
    full_name IS NULL
    OR TRIM(full_name) = ''
    OR full_name LIKE '%@%'
  );

COMMIT;
