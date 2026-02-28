select exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='profile_media_provider');
