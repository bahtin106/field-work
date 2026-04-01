-- Fix error_logs insertability and RLS robustness.

-- 1) Ensure generator state is valid.
select setval(
  'public.error_logs_id_seq',
  greatest(coalesce((select max(id) from public.error_logs), 0), 1),
  (select exists(select 1 from public.error_logs))
);

-- For non-identity setups keep default nextval; skip for identity columns.
do $$
declare
  v_is_identity text;
begin
  select is_identity
    into v_is_identity
  from information_schema.columns
  where table_schema='public' and table_name='error_logs' and column_name='id';

  if coalesce(v_is_identity, 'NO') = 'NO' then
    alter table public.error_logs
      alter column id set default nextval('public.error_logs_id_seq'::regclass);
    alter sequence public.error_logs_id_seq owned by public.error_logs.id;
  end if;
end
$$;

-- 2) RLS based on auth.uid().
drop policy if exists error_logs_insert_any on public.error_logs;
drop policy if exists error_logs_select_own on public.error_logs;
drop policy if exists error_logs_insert_own on public.error_logs;

create policy error_logs_insert_own
on public.error_logs
for insert
to authenticated
with check (
  auth.uid() is not null
  and user_id = auth.uid()
);

create policy error_logs_select_own
on public.error_logs
for select
to authenticated
using (user_id = auth.uid());

-- 3) Keep grants explicit.
revoke all on table public.error_logs from authenticated;
grant insert, select on table public.error_logs to authenticated;
