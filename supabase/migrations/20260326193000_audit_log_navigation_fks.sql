begin;

-- High-quality navigation model for audit logs:
-- 1) explicit FK to company
-- 2) typed entity reference columns with FKs (because one polymorphic entity_id cannot have a single FK)

alter table public.app_entity_audit_log
  add column if not exists order_id uuid,
  add column if not exists client_id uuid,
  add column if not exists client_object_id uuid,
  add column if not exists order_finance_entry_id uuid,
  add column if not exists company_finance_rule_id uuid;

-- Company relation for quick jump in Studio.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_entity_audit_log_company_id_fkey'
      and conrelid = 'public.app_entity_audit_log'::regclass
  ) then
    alter table public.app_entity_audit_log
      add constraint app_entity_audit_log_company_id_fkey
      foreign key (company_id) references public.companies(id)
      on delete set null;
  end if;
end
$$;

-- Typed entity relations.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='app_entity_audit_log_order_id_fkey'
      and conrelid='public.app_entity_audit_log'::regclass
  ) then
    alter table public.app_entity_audit_log
      add constraint app_entity_audit_log_order_id_fkey
      foreign key (order_id) references public.orders(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='app_entity_audit_log_client_id_fkey'
      and conrelid='public.app_entity_audit_log'::regclass
  ) then
    alter table public.app_entity_audit_log
      add constraint app_entity_audit_log_client_id_fkey
      foreign key (client_id) references public.clients(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='app_entity_audit_log_client_object_id_fkey'
      and conrelid='public.app_entity_audit_log'::regclass
  ) then
    alter table public.app_entity_audit_log
      add constraint app_entity_audit_log_client_object_id_fkey
      foreign key (client_object_id) references public.client_objects(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='app_entity_audit_log_order_finance_entry_id_fkey'
      and conrelid='public.app_entity_audit_log'::regclass
  ) then
    alter table public.app_entity_audit_log
      add constraint app_entity_audit_log_order_finance_entry_id_fkey
      foreign key (order_finance_entry_id) references public.order_finance_entries(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='app_entity_audit_log_company_finance_rule_id_fkey'
      and conrelid='public.app_entity_audit_log'::regclass
  ) then
    alter table public.app_entity_audit_log
      add constraint app_entity_audit_log_company_finance_rule_id_fkey
      foreign key (company_finance_rule_id) references public.company_finance_rules(id)
      on delete set null;
  end if;
end
$$;

-- Backfill typed links for existing rows (only valid UUID entity_id values).
update public.app_entity_audit_log
set
  order_id = case
    when entity_type='orders'
      and entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (select 1 from public.orders o where o.id = entity_id::uuid)
    then entity_id::uuid else null end,
  client_id = case
    when entity_type='clients'
      and entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (select 1 from public.clients c where c.id = entity_id::uuid)
    then entity_id::uuid else null end,
  client_object_id = case
    when entity_type='client_objects'
      and entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (select 1 from public.client_objects co where co.id = entity_id::uuid)
    then entity_id::uuid else null end,
  order_finance_entry_id = case
    when entity_type='order_finance_entries'
      and entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (select 1 from public.order_finance_entries ofe where ofe.id = entity_id::uuid)
    then entity_id::uuid else null end,
  company_finance_rule_id = case
    when entity_type='company_finance_rules'
      and entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (select 1 from public.company_finance_rules cfr where cfr.id = entity_id::uuid)
    then entity_id::uuid else null end;

-- Validate FK constraints after backfill.
alter table public.app_entity_audit_log validate constraint app_entity_audit_log_company_id_fkey;
alter table public.app_entity_audit_log validate constraint app_entity_audit_log_order_id_fkey;
alter table public.app_entity_audit_log validate constraint app_entity_audit_log_client_id_fkey;
alter table public.app_entity_audit_log validate constraint app_entity_audit_log_client_object_id_fkey;
alter table public.app_entity_audit_log validate constraint app_entity_audit_log_order_finance_entry_id_fkey;
alter table public.app_entity_audit_log validate constraint app_entity_audit_log_company_finance_rule_id_fkey;

-- Convenience indexes for Studio filters / joins.
create index if not exists app_entity_audit_log_order_id_created_idx on public.app_entity_audit_log(order_id, created_at desc) where order_id is not null;
create index if not exists app_entity_audit_log_client_id_created_idx on public.app_entity_audit_log(client_id, created_at desc) where client_id is not null;
create index if not exists app_entity_audit_log_client_object_id_created_idx on public.app_entity_audit_log(client_object_id, created_at desc) where client_object_id is not null;
create index if not exists app_entity_audit_log_order_finance_entry_id_created_idx on public.app_entity_audit_log(order_finance_entry_id, created_at desc) where order_finance_entry_id is not null;
create index if not exists app_entity_audit_log_company_finance_rule_id_created_idx on public.app_entity_audit_log(company_finance_rule_id, created_at desc) where company_finance_rule_id is not null;

-- Keep writer in sync for new rows.
create or replace function public.entity_audit_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := lower(tg_op);
  v_company_id uuid;
  v_entity_id text;
  v_before jsonb;
  v_after jsonb;
  v_before_cmp jsonb;
  v_after_cmp jsonb;
  v_changed_fields text[];
  v_noise_keys text[] := array[
    'updated_at',
    'updated_by',
    'finance_calculated_at'
  ];
  v_entity_uuid uuid;
  v_order_id uuid;
  v_client_id uuid;
  v_client_object_id uuid;
  v_order_finance_entry_id uuid;
  v_company_finance_rule_id uuid;
begin
  if v_action = 'insert' then
    v_after := to_jsonb(new);
    v_before := null;
    v_changed_fields := null;
  elsif v_action = 'update' then
    v_after := to_jsonb(new);
    v_before := to_jsonb(old);

    v_before_cmp := coalesce(v_before, '{}'::jsonb) - v_noise_keys;
    v_after_cmp := coalesce(v_after, '{}'::jsonb) - v_noise_keys;

    if v_after_cmp = v_before_cmp then
      return coalesce(new, old);
    end if;

    select coalesce(array_agg(k order by k), '{}'::text[])
      into v_changed_fields
    from (
      select jsonb_object_keys as k
      from jsonb_object_keys(v_before_cmp || v_after_cmp)
    ) keys
    where v_before_cmp -> keys.k is distinct from v_after_cmp -> keys.k;
  else
    v_after := null;
    v_before := to_jsonb(old);
    v_changed_fields := null;
  end if;

  v_company_id := coalesce((v_after->>'company_id')::uuid, (v_before->>'company_id')::uuid);
  v_entity_id := coalesce(v_after->>'id', v_before->>'id', 'unknown');

  v_entity_uuid := null;
  if v_entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_entity_uuid := v_entity_id::uuid;
  end if;

  v_order_id := null;
  v_client_id := null;
  v_client_object_id := null;
  v_order_finance_entry_id := null;
  v_company_finance_rule_id := null;

  if tg_table_name = 'orders' then
    v_order_id := v_entity_uuid;
  elsif tg_table_name = 'clients' then
    v_client_id := v_entity_uuid;
  elsif tg_table_name = 'client_objects' then
    v_client_object_id := v_entity_uuid;
  elsif tg_table_name = 'order_finance_entries' then
    v_order_finance_entry_id := v_entity_uuid;
  elsif tg_table_name = 'company_finance_rules' then
    v_company_finance_rule_id := v_entity_uuid;
  end if;

  insert into public.app_entity_audit_log (
    company_id,
    entity_type,
    entity_id,
    action,
    actor_user_id,
    before_data,
    after_data,
    changed_fields,
    order_id,
    client_id,
    client_object_id,
    order_finance_entry_id,
    company_finance_rule_id
  ) values (
    v_company_id,
    tg_table_name,
    v_entity_id,
    v_action,
    auth.uid(),
    v_before,
    v_after,
    v_changed_fields,
    v_order_id,
    v_client_id,
    v_client_object_id,
    v_order_finance_entry_id,
    v_company_finance_rule_id
  );

  return coalesce(new, old);
end;
$$;

commit;
