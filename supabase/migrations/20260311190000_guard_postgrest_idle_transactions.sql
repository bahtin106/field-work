BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    EXECUTE 'ALTER ROLE authenticator SET idle_in_transaction_session_timeout = ''15s''';
  END IF;
END
$$;

COMMIT;
