begin;

update public.client_tag_links l
set created_by = null
where l.created_by is not null
  and not exists (
    select 1
    from public.profiles p
    where p.id = l.created_by
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_tag_links_created_by_fkey'
      and conrelid = 'public.client_tag_links'::regclass
  ) then
    alter table public.client_tag_links
      add constraint client_tag_links_created_by_fkey
      foreign key (created_by) references public.profiles(id)
      on delete set null
      not valid;
  end if;
end
$$;

alter table public.client_tag_links
  validate constraint client_tag_links_created_by_fkey;

commit;
