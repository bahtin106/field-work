do $$
begin
  if to_regclass('public.companies') is null then
    return;
  end if;

  alter table public.companies
    add column if not exists worker_phone_show_condition text,
    add column if not exists worker_phone_show_offset_mins integer,
    add column if not exists worker_phone_show_status text,
    add column if not exists worker_phone_hide_condition text,
    add column if not exists worker_phone_hide_offset_mins integer,
    add column if not exists worker_phone_hide_status text;

  update public.companies
  set
    worker_phone_show_condition = coalesce(
      worker_phone_show_condition,
      case lower(coalesce(worker_phone_mode, ''))
        when 'always' then 'always'
        when 'off' then 'never'
        when 'never' then 'never'
        else 'time_before_departure'
      end
    ),
    worker_phone_show_offset_mins = coalesce(
      worker_phone_show_offset_mins,
      case lower(coalesce(worker_phone_mode, ''))
        when 'always' then 0
        when 'off' then 0
        when 'never' then 0
        else least(greatest(coalesce(worker_phone_window_before_mins, 720), 0), 43200)
      end
    ),
    worker_phone_show_status = coalesce(worker_phone_show_status, 'in_progress'),
    worker_phone_hide_condition = coalesce(
      worker_phone_hide_condition,
      case lower(coalesce(worker_phone_mode, ''))
        when 'always' then 'never'
        when 'off' then 'never'
        when 'never' then 'never'
        else 'time_after_departure'
      end
    ),
    worker_phone_hide_offset_mins = coalesce(
      worker_phone_hide_offset_mins,
      case lower(coalesce(worker_phone_mode, ''))
        when 'always' then 0
        when 'off' then 0
        when 'never' then 0
        else least(greatest(coalesce(worker_phone_window_after_mins, 360), 0), 43200)
      end
    ),
    worker_phone_hide_status = coalesce(worker_phone_hide_status, 'done');

  alter table public.companies
    alter column worker_phone_show_condition set default 'time_before_departure',
    alter column worker_phone_show_condition set not null,
    alter column worker_phone_show_offset_mins set default 720,
    alter column worker_phone_show_offset_mins set not null,
    alter column worker_phone_show_status set default 'in_progress',
    alter column worker_phone_show_status set not null,
    alter column worker_phone_hide_condition set default 'time_after_departure',
    alter column worker_phone_hide_condition set not null,
    alter column worker_phone_hide_offset_mins set default 360,
    alter column worker_phone_hide_offset_mins set not null,
    alter column worker_phone_hide_status set default 'done',
    alter column worker_phone_hide_status set not null;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_worker_phone_show_condition_valid'
  ) then
    alter table public.companies
      add constraint companies_worker_phone_show_condition_valid
      check (worker_phone_show_condition in ('always', 'never', 'time_before_departure', 'status'))
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_worker_phone_hide_condition_valid'
  ) then
    alter table public.companies
      add constraint companies_worker_phone_hide_condition_valid
      check (worker_phone_hide_condition in ('never', 'time_after_departure', 'status'))
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_worker_phone_offsets_valid'
  ) then
    alter table public.companies
      add constraint companies_worker_phone_offsets_valid
      check (
        worker_phone_show_offset_mins between 0 and 43200
        and worker_phone_hide_offset_mins between 0 and 43200
      )
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_worker_phone_statuses_valid'
  ) then
    alter table public.companies
      add constraint companies_worker_phone_statuses_valid
      check (
        worker_phone_show_status in ('feed', 'new', 'in_progress', 'done')
        and worker_phone_hide_status in ('feed', 'new', 'in_progress', 'done')
      )
      not valid;
  end if;
end $$;

do $$
begin
  if to_regclass('public.companies') is null then
    return;
  end if;

  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
      and puballtables = false
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'companies'
  ) then
    alter publication supabase_realtime add table public.companies;
  end if;
end $$;
