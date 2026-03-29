-- Prevent FK violations in app_entity_audit_log when source entity is deleted.
-- Keep navigation FK columns only for insert/update actions.

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

  if v_action <> 'delete' then
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

