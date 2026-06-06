alter table if exists public.companies
  alter column feed_order_card_fields
  set default '["customer_name","address","departure_time","finance"]'::jsonb;

update public.companies
set feed_order_card_fields = '["customer_name","address","departure_time","finance"]'::jsonb
where feed_order_card_fields = '["title","customer_name","address","assigned_to_name"]'::jsonb;
