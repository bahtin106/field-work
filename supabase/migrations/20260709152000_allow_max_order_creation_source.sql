alter table public.orders
  drop constraint if exists orders_creation_source_check;

alter table public.orders
  add constraint orders_creation_source_check
  check (creation_source = any (array[
    'app'::text,
    'telegram'::text,
    'max'::text,
    'api'::text,
    'import'::text,
    'system'::text
  ]));
