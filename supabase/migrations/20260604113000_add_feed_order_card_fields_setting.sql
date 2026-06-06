alter table if exists public.companies
  add column if not exists feed_order_card_fields jsonb
  not null
  default '["title","customer_name","address","assigned_to_name"]'::jsonb;

do $$
begin
  if to_regclass('public.companies') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'companies_feed_order_card_fields_is_array'
     ) then
    alter table public.companies
      add constraint companies_feed_order_card_fields_is_array
      check (jsonb_typeof(feed_order_card_fields) = 'array')
      not valid;
  end if;
end $$;
