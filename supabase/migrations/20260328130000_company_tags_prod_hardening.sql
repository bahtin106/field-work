begin;

-- 1) Data hygiene before FKs.
update public.company_tags t
set created_by = null
where t.created_by is not null
  and not exists (select 1 from public.profiles p where p.id = t.created_by);

update public.company_tags t
set updated_by = null
where t.updated_by is not null
  and not exists (select 1 from public.profiles p where p.id = t.updated_by);

-- 2) FK navigation arrows in Supabase Studio for audit users.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_tags_created_by_fkey'
      and conrelid = 'public.company_tags'::regclass
  ) then
    alter table public.company_tags
      add constraint company_tags_created_by_fkey
      foreign key (created_by)
      references public.profiles(id)
      on delete set null
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_tags_updated_by_fkey'
      and conrelid = 'public.company_tags'::regclass
  ) then
    alter table public.company_tags
      add constraint company_tags_updated_by_fkey
      foreign key (updated_by)
      references public.profiles(id)
      on delete set null
      not valid;
  end if;
end
$$;

alter table public.company_tags
  validate constraint company_tags_created_by_fkey;
alter table public.company_tags
  validate constraint company_tags_updated_by_fkey;

-- 3) Integrity hardening (defense-in-depth).
alter table public.company_tags
  drop constraint if exists company_tags_value_nonempty_check,
  drop constraint if exists company_tags_normalized_nonempty_check,
  drop constraint if exists company_tags_normalized_consistency_check;

alter table public.company_tags
  add constraint company_tags_value_nonempty_check
    check (btrim(value) <> ''),
  add constraint company_tags_normalized_nonempty_check
    check (btrim(normalized_value) <> ''),
  add constraint company_tags_normalized_consistency_check
    check (normalized_value = lower(value));

-- 4) Prefix-search performance index for large tag dictionaries.
create index if not exists company_tags_lookup_prefix_idx
  on public.company_tags (company_id, tag_type, normalized_value text_pattern_ops, value);

commit;