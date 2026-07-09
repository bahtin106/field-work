alter table public.orders
  drop constraint if exists orders_object_id_fkey;

alter table public.orders
  add constraint orders_object_id_fkey
  foreign key (object_id)
  references public.client_objects(id)
  on delete set null;
