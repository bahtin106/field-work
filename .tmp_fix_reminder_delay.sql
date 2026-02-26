ALTER TABLE public.notification_prefs
  ADD COLUMN IF NOT EXISTS reminder_delay_minutes integer NOT NULL DEFAULT 20;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_prefs_reminder_delay_minutes_check'
      AND conrelid = 'public.notification_prefs'::regclass
  ) THEN
    ALTER TABLE public.notification_prefs
      ADD CONSTRAINT notification_prefs_reminder_delay_minutes_check
      CHECK (reminder_delay_minutes BETWEEN 1 AND 43200);
  END IF;
END $$;

SELECT column_name
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='notification_prefs'
  AND column_name='reminder_delay_minutes';
