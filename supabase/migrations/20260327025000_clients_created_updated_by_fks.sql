begin;

update public.clients c
set created_by = null
where c.created_by is not null
  and not exists (
    select 1 from public.profiles p where p.id = c.created_by
  );

update public.clients c
set updated_by = null
where c.updated_by is not null
  and not exists (
    select 1 from public.profiles p where p.id = c.updated_by
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_created_by_fkey'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_created_by_fkey
      foreign key (created_by) references public.profiles(id)
      on delete set null
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_updated_by_fkey'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_updated_by_fkey
      foreign key (updated_by) references public.profiles(id)
      on delete set null
      not valid;
  end if;
end
$$;

alter table public.clients validate constraint clients_created_by_fkey;
alter table public.clients validate constraint clients_updated_by_fkey;

commit;
