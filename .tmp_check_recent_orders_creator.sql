select id, status, created_by_user_id, assigned_to, created_at, updated_at,
       to_jsonb(o)->>'created_by' as created_by_text,
       to_jsonb(o)->>'user_id' as user_id_text,
       to_jsonb(o)->>'owner_id' as owner_id_text
from public.orders o
order by created_at desc
limit 20;
