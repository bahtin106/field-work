begin;

alter table public.company_order_statuses
  add column if not exists color text;

create or replace function public.company_order_status_default_color(p_status_key text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(p_status_key, '')))
    when 'feed' then '#8A6D1F'
    when 'new' then '#0A84FF'
    when 'in_progress' then '#34C759'
    when 'done' then '#6B7280'
    when 'waiting' then '#6B7280'
    else null
  end;
$$;

create or replace function public.company_order_statuses_set_color()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_palette constant text[] := array[
    '#0A84FF', '#5856D6', '#AF52DE', '#E5484D', '#D97706', '#8A6D1F',
    '#34C759', '#0F9D8A', '#168AAD', '#4F6BED', '#8B5CF6', '#64748B'
  ];
  v_default text;
begin
  new.color := upper(btrim(coalesce(new.color, '')));

  if new.color = '' then
    v_default := public.company_order_status_default_color(new.status_key);
    new.color := coalesce(
      v_default,
      v_palette[1 + floor(random() * array_length(v_palette, 1))::integer]
    );
  end if;

  if new.color !~ '^#[0-9A-F]{6}$' then
    raise exception 'company_order_status_color_invalid' using errcode = '23514';
  end if;

  return new;
end;
$$;

update public.company_order_statuses s
   set color = coalesce(
     public.company_order_status_default_color(s.status_key),
     (array[
       '#0A84FF', '#5856D6', '#AF52DE', '#E5484D', '#D97706', '#8A6D1F',
       '#34C759', '#0F9D8A', '#168AAD', '#4F6BED', '#8B5CF6', '#64748B'
     ])[1 + (get_byte(decode(md5(s.id::text), 'hex'), 0) % 12)]
   )
 where color is null or btrim(color) = '';

alter table public.company_order_statuses
  alter column color set not null;

alter table public.company_order_statuses
  drop constraint if exists company_order_statuses_color_check;

alter table public.company_order_statuses
  add constraint company_order_statuses_color_check
  check (color ~ '^#[0-9A-F]{6}$');

drop trigger if exists trg_company_order_statuses_set_color on public.company_order_statuses;
create trigger trg_company_order_statuses_set_color
before insert or update of color, status_key on public.company_order_statuses
for each row
execute function public.company_order_statuses_set_color();

revoke all on function public.company_order_status_default_color(text) from public, anon, authenticated;
grant execute on function public.company_order_status_default_color(text) to service_role;
revoke all on function public.company_order_statuses_set_color() from public, anon, authenticated;

commit;
