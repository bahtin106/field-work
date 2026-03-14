set search_path = public;

alter table public.order_finance_entries
  add column if not exists photo_urls text[] not null default '{}'::text[];

create table if not exists public.finance_entry_media_external_map (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  finance_entry_id uuid not null references public.order_finance_entries(id) on delete cascade,
  provider text not null check (provider in ('beget_s3', 'yandex_disk')),
  source_url text not null,
  external_path text not null,
  display_url text,
  display_url_updated_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (finance_entry_id, source_url)
);

create index if not exists idx_finance_entry_media_external_map_entry
  on public.finance_entry_media_external_map (finance_entry_id, created_at);

create index if not exists idx_finance_entry_media_external_map_order
  on public.finance_entry_media_external_map (order_id, finance_entry_id);

alter table public.finance_entry_media_external_map enable row level security;
revoke all on public.finance_entry_media_external_map from anon, authenticated;

create or replace function public.append_order_finance_entry_photo_url(
  p_finance_entry_id uuid,
  p_company_id uuid,
  p_url text
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
         updated_by = auth.uid()
   where e.id = v_entry.id
   returning e.photo_urls, e.updated_at
    into photo_urls, updated_at;

  return next;
end;
$$;

create or replace function public.remove_order_finance_entry_photo_url(
  p_finance_entry_id uuid,
  p_company_id uuid,
  p_url text
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
         updated_by = auth.uid()
   where e.id = v_entry.id
   returning e.photo_urls, e.updated_at
    into photo_urls, updated_at;

  return next;
end;
$$;

grant execute on function public.append_order_finance_entry_photo_url(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.remove_order_finance_entry_photo_url(uuid, uuid, text) to authenticated, service_role;

drop trigger if exists trg_finance_entry_media_external_map_enqueue_cleanup on public.finance_entry_media_external_map;
create trigger trg_finance_entry_media_external_map_enqueue_cleanup
after delete on public.finance_entry_media_external_map
for each row
execute function public.enqueue_media_cleanup_from_order_map_delete();
