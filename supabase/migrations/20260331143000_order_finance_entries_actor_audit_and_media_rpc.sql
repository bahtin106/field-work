begin;

-- 1) Actor-aware RPC overloads for finance entry media updates.
create or replace function public.append_order_finance_entry_photo_url(
  p_finance_entry_id uuid,
  p_company_id uuid,
  p_url text,
  p_actor_user_id uuid default null
)
returns table(photo_urls text[], updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.order_finance_entries%rowtype;
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_next text[];
  v_actor uuid := coalesce(auth.uid(), p_actor_user_id);
begin
  if p_finance_entry_id is null then
    raise exception 'finance_entry_id is required';
  end if;
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;
  if v_url is null then
    raise exception 'url is required';
  end if;

  select *
    into v_entry
    from public.order_finance_entries e
   where e.id = p_finance_entry_id
     and e.company_id = p_company_id
   for update;

  if not found then
    raise exception 'Finance entry not found';
  end if;

  select coalesce(array_agg(distinct_url order by ord), '{}'::text[])
    into v_next
    from (
      select distinct on (distinct_url) distinct_url, ord
        from unnest(array[v_url] || coalesce(v_entry.photo_urls, '{}'::text[])) with ordinality as t(distinct_url, ord)
       where nullif(btrim(coalesce(distinct_url, '')), '') is not null
       order by distinct_url, ord
    ) dedup;

  update public.order_finance_entries e
     set photo_urls = v_next,
         updated_at = now(),
         updated_by = coalesce(v_actor, e.updated_by, e.created_by)
   where e.id = v_entry.id
   returning e.photo_urls, e.updated_at
    into photo_urls, updated_at;

  return next;
end;
$$;

create or replace function public.remove_order_finance_entry_photo_url(
  p_finance_entry_id uuid,
  p_company_id uuid,
  p_url text,
  p_actor_user_id uuid default null
)
returns table(photo_urls text[], updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.order_finance_entries%rowtype;
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_next text[];
  v_actor uuid := coalesce(auth.uid(), p_actor_user_id);
begin
  if p_finance_entry_id is null then
    raise exception 'finance_entry_id is required';
  end if;
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;
  if v_url is null then
    raise exception 'url is required';
  end if;

  select *
    into v_entry
    from public.order_finance_entries e
   where e.id = p_finance_entry_id
     and e.company_id = p_company_id
   for update;

  if not found then
    raise exception 'Finance entry not found';
  end if;

  select coalesce(array_agg(next_url order by ord), '{}'::text[])
    into v_next
    from (
      select next_url, ord
        from unnest(coalesce(v_entry.photo_urls, '{}'::text[])) with ordinality as t(next_url, ord)
       where nullif(btrim(coalesce(next_url, '')), '') is not null
         and next_url <> v_url
    ) filtered;

  update public.order_finance_entries e
     set photo_urls = coalesce(v_next, '{}'::text[]),
         updated_at = now(),
         updated_by = coalesce(v_actor, e.updated_by, e.created_by)
   where e.id = v_entry.id
   returning e.photo_urls, e.updated_at
    into photo_urls, updated_at;

  return next;
end;
$$;

grant execute on function public.append_order_finance_entry_photo_url(uuid, uuid, text, uuid)
  to authenticated, service_role;
grant execute on function public.remove_order_finance_entry_photo_url(uuid, uuid, text, uuid)
  to authenticated, service_role;

-- 2) Stable audit actor + normalization on every write.
create or replace function public.order_finance_entries_sync_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.updated_by, old.updated_by, new.created_by, old.created_by);
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, new.created_at, now());
    new.created_by := coalesce(new.created_by, v_actor);
    new.updated_by := coalesce(new.updated_by, new.created_by, v_actor);
  else
    new.updated_at := now();
    new.updated_by := coalesce(v_actor, old.updated_by, old.created_by, new.updated_by);
    new.created_at := coalesce(new.created_at, old.created_at, now());
    new.created_by := coalesce(new.created_by, old.created_by, new.updated_by);
  end if;

  if lower(coalesce(new.calc_mode, 'fixed')) = 'fixed' then
    new.input_percent := 0;
  else
    new.input_amount := 0;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_finance_entries_sync_audit_fields on public.order_finance_entries;
create trigger trg_order_finance_entries_sync_audit_fields
before insert or update on public.order_finance_entries
for each row
execute function public.order_finance_entries_sync_audit_fields();

-- 3) One-time cleanup for already saved rows.
update public.order_finance_entries
set updated_by = created_by
where updated_by is null
  and created_by is not null;

update public.order_finance_entries
set input_percent = 0
where lower(coalesce(calc_mode, 'fixed')) = 'fixed'
  and coalesce(input_percent, 0) <> 0;

update public.order_finance_entries
set input_amount = 0
where lower(coalesce(calc_mode, 'fixed')) = 'percent'
  and coalesce(input_amount, 0) <> 0;

commit;
