CREATE TEMP TABLE tmp_email_hits(tbl text, cnt bigint);
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema IN ('public','auth')
      AND lower(column_name) = 'email'
      AND data_type IN ('text','character varying','character')
  LOOP
    EXECUTE format(
      'INSERT INTO tmp_email_hits(tbl, cnt) SELECT %L, count(*) FROM %I.%I WHERE lower(%I)=lower(%L)',
      r.table_schema||'.'||r.table_name,
      r.table_schema,
      r.table_name,
      r.column_name,
      'expresspoliv@gmail.com'
    );
  END LOOP;
END $$;

SELECT * FROM tmp_email_hits WHERE cnt > 0 ORDER BY tbl;
