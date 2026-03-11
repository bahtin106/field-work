\d+ public.profile_media_external_map
select id, company_id, entity_type, entity_id, provider, left(db_url,120) as db_url, left(external_path,120) as external_path, updated_at from public.profile_media_external_map order by updated_at desc nulls last, id desc limit 10;
