select exists (select 1 from information_schema.tables where table_schema='public' and table_name='profile_media_external_map');
