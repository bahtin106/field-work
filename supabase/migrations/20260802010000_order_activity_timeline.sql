-- Read-only order activity timeline backed by the existing immutable audit log.
-- The UI never reads before_data/after_data directly; this migration exposes a
-- permission-aware, field-allowlisted RPC instead.

alter table public.companies
  add column if not exists order_history_enabled boolean not null default false;

comment on column public.companies.order_history_enabled is
  'Controls whether the request activity timeline is available to this company. Role permissions are applied only when this feature is enabled.';

create or replace function public.set_company_order_history_enabled_v1(
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'auth'
as $function$
declare
  v_company_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if lower(coalesce(public.user_role(), '')) <> 'admin' then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;

  v_company_id := public.user_company_id();
  if v_company_id is null then
    raise exception 'Company is not accessible' using errcode = '42501';
  end if;

  update public.companies
     set order_history_enabled = coalesce(p_enabled, false)
   where id = v_company_id;

  if not found then
    raise exception 'Company is not accessible' using errcode = '42501';
  end if;

  return true;
end;
$function$;

revoke all on function public.set_company_order_history_enabled_v1(boolean)
  from public, anon;
grant execute on function public.set_company_order_history_enabled_v1(boolean)
  to authenticated;

insert into public.app_role_permissions (company_id, role, key, value)
select
  c.id,
  defaults.role,
  'canViewOrderHistory',
  defaults.value
from public.companies c
cross join (
  values
    ('admin'::text, true),
    ('dispatcher'::text, true),
    ('worker'::text, false)
) as defaults(role, value)
on conflict (company_id, role, key) do nothing;

create or replace function public.order_permission_default(p_role text, p_key text)
returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'public', 'auth', 'storage', 'extensions'
as $function$
  select case
    when lower(coalesce(p_role, '')) in ('admin', 'dispatcher') then
      p_key in (
        'canCreateOrders', 'canEditOrders', 'canCompleteOwnOrders', 'canCompleteOtherOrders',
        'canViewAllOrders', 'canDeleteOrders', 'canViewOrderPhotos',
        'canAddGalleryPhotos', 'canAddCameraPhotos', 'canViewOrderHistory'
      )
    when lower(coalesce(p_role, '')) = 'worker' then
      p_key in ('canViewOrderPhotos', 'canAddCameraPhotos')
    else false
  end;
$function$;

create or replace function public.order_activity_value_is_distinct(
  p_before jsonb,
  p_after jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path to 'pg_catalog'
as $function$
  select case
    when jsonb_typeof(p_before) = 'number' and jsonb_typeof(p_after) = 'number'
      then (p_before #>> '{}')::numeric is distinct from (p_after #>> '{}')::numeric
    else p_before is distinct from p_after
  end;
$function$;

revoke all on function public.order_activity_value_is_distinct(jsonb, jsonb)
  from public, anon, authenticated;

create or replace function public.entity_audit_capture()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_related_order_id text;
  v_order_id uuid;
  v_client_id uuid;
  v_client_object_id uuid;
  v_order_finance_entry_id uuid;
  v_company_finance_rule_id uuid;
  v_actor_user_id uuid;
  v_actor_candidate text;
  v_initialization_patch jsonb;
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
    where public.order_activity_value_is_distinct(
      v_before_cmp -> keys.k,
      v_after_cmp -> keys.k
    );

    if cardinality(v_changed_fields) = 0 then
      return coalesce(new, old);
    end if;
  else
    v_after := null;
    v_before := to_jsonb(old);
    v_changed_fields := null;
  end if;

  v_company_id := coalesce((v_after->>'company_id')::uuid, (v_before->>'company_id')::uuid);
  v_entity_id := coalesce(v_after->>'id', v_before->>'id', 'unknown');

  -- Creating a finance entry first inserts the business data and then, in the
  -- same transaction, initializes derived fields such as calculated_amount.
  -- That follow-up write is part of the creation action, not a second user
  -- action, so it must not create another audit event.
  if tg_table_name = 'order_finance_entries'
     and v_action = 'update'
     and cardinality(v_changed_fields) > 0
     and v_changed_fields <@ array['calculated_amount', 'finance_effect']::text[]
     and exists (
       select 1
       from public.app_entity_audit_log inserted
       where inserted.company_id = v_company_id
         and inserted.entity_type = 'order_finance_entries'
         and inserted.entity_id = v_entity_id
         and inserted.action = 'insert'
         and inserted.created_at = transaction_timestamp()
     ) then
    select coalesce(jsonb_object_agg(field, v_after -> field), '{}'::jsonb)
      into v_initialization_patch
    from unnest(v_changed_fields) field;

    update public.app_entity_audit_log inserted
    set after_data = coalesce(inserted.after_data, '{}'::jsonb) || v_initialization_patch
    where inserted.company_id = v_company_id
      and inserted.entity_type = 'order_finance_entries'
      and inserted.entity_id = v_entity_id
      and inserted.action = 'insert'
      and inserted.created_at = transaction_timestamp();

    return coalesce(new, old);
  end if;

  v_entity_uuid := null;
  if v_entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_entity_uuid := v_entity_id::uuid;
  end if;

  v_related_order_id := coalesce(v_after->>'order_id', v_before->>'order_id');
  v_order_id := case
    when tg_table_name = 'orders' then v_entity_uuid
    when v_related_order_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then v_related_order_id::uuid
    else null
  end;
  v_client_id := case when tg_table_name = 'clients' then v_entity_uuid else null end;
  v_client_object_id := case when tg_table_name = 'client_objects' then v_entity_uuid else null end;
  v_order_finance_entry_id := case when tg_table_name = 'order_finance_entries' then v_entity_uuid else null end;
  v_company_finance_rule_id := case when tg_table_name = 'company_finance_rules' then v_entity_uuid else null end;

  -- Direct API calls carry auth.uid(). Some server-side RPCs legitimately write
  -- on behalf of a user and preserve that user in the row metadata. Use that
  -- metadata only when it identifies a profile in the same company. Never infer
  -- an actor for deletes or from an entity's original creator during an update.
  v_actor_user_id := auth.uid();
  if v_actor_user_id is null and v_action = 'insert' then
    v_actor_candidate := coalesce(
      nullif(v_after->>'created_by', ''),
      nullif(v_after->>'created_by_user_id', ''),
      nullif(v_after->>'updated_by', ''),
      nullif(v_after->>'updated_by_user_id', '')
    );
  elsif v_actor_user_id is null and v_action = 'update' then
    v_actor_candidate := coalesce(
      nullif(v_after->>'updated_by', ''),
      nullif(v_after->>'updated_by_user_id', '')
    );
  end if;

  if v_actor_user_id is null
     and v_actor_candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select p.id
      into v_actor_user_id
    from public.profiles p
    where p.id = v_actor_candidate::uuid
      and p.company_id = v_company_id;
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
    v_actor_user_id,
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
$function$;

drop trigger if exists trg_order_customer_payments_audit_capture on public.order_customer_payments;
create trigger trg_order_customer_payments_audit_capture
after insert or update or delete on public.order_customer_payments
for each row execute function public.entity_audit_capture();

-- Payments created before the audit trigger still belong in the archive. The
-- current row is stored as an imported creation snapshot; future mutations are
-- captured transactionally by the trigger above.
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
  created_at
)
select
  payment.company_id,
  'order_customer_payments',
  payment.id::text,
  'insert',
  coalesce(payment.created_by, payment.updated_by),
  null,
  to_jsonb(payment),
  null,
  payment.order_id,
  payment.created_at
from public.order_customer_payments payment
where not exists (
  select 1
  from public.app_entity_audit_log audit
  where audit.entity_type = 'order_customer_payments'
    and audit.entity_id = payment.id::text
);

-- Existing finance-entry audit rows contain order_id in their snapshots but the
-- typed lookup column was not populated by the old generic trigger.
update public.app_entity_audit_log a
set order_id = coalesce(
  nullif(a.after_data->>'order_id', '')::uuid,
  nullif(a.before_data->>'order_id', '')::uuid
)
where a.entity_type = 'order_finance_entries'
  and a.order_id is null
  and coalesce(a.after_data->>'order_id', a.before_data->>'order_id', '')
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.orders o
    where o.id = coalesce(
      nullif(a.after_data->>'order_id', '')::uuid,
      nullif(a.before_data->>'order_id', '')::uuid
    )
  );

create or replace function public.order_activity_value_ref(
  p_field text,
  p_value jsonb,
  p_company_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'storage', 'extensions'
as $function$
declare
  v_id uuid;
  v_kind text;
  v_label text;
begin
  if p_value is null or p_value = 'null'::jsonb then
    return null;
  end if;

  if p_field = 'status' then
    select s.name into v_label
    from public.company_order_statuses s
    where s.company_id = p_company_id
      and s.status_key = trim(both '"' from p_value::text)
    limit 1;

    return jsonb_build_object(
      'label', coalesce(v_label, trim(both '"' from p_value::text)),
      'available', true
    );
  end if;

  if p_field in ('assigned_to', 'created_by_user_id', 'recipient_user_id', 'created_by', 'updated_by') then
    v_kind := 'user';
  elsif p_field = 'client_id' then
    v_kind := 'client';
  elsif p_field = 'object_id' then
    v_kind := 'object';
  elsif p_field = 'work_type_id' then
    v_kind := 'work_type';
  else
    return null;
  end if;

  begin
    v_id := trim(both '"' from p_value::text)::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;

  if v_kind = 'user' then
    select coalesce(
      nullif(btrim(p.full_name), ''),
      nullif(btrim(concat_ws(' ', p.last_name, p.first_name, p.middle_name)), ''),
      ''
    )
    into v_label
    from public.profiles p
    where p.id = v_id and p.company_id = p_company_id;
  elsif v_kind = 'client' then
    select coalesce(
      nullif(btrim(c.full_name), ''),
      nullif(btrim(concat_ws(' ', c.last_name, c.first_name, c.middle_name)), ''),
      ''
    )
    into v_label
    from public.clients c
    where c.id = v_id and c.company_id = p_company_id;
  elsif v_kind = 'object' then
    select coalesce(nullif(btrim(o.name), ''), '')
    into v_label
    from public.client_objects o
    where o.id = v_id and o.company_id = p_company_id;
  elsif v_kind = 'work_type' then
    select coalesce(nullif(btrim(w.name), ''), '')
    into v_label
    from public.work_types w
    where w.id = v_id and w.company_id = p_company_id;
  end if;

  return jsonb_build_object(
    'entity_type', v_kind,
    'entity_id', v_id,
    'label', coalesce(v_label, ''),
    'available', v_label is not null
  );
end;
$function$;

revoke all on function public.order_activity_value_ref(text, jsonb, uuid)
  from public, anon, authenticated;

create or replace function public.get_order_activity(
  p_order_id uuid,
  p_limit integer default 30,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  event_id uuid,
  occurred_at timestamptz,
  action text,
  entity_type text,
  actor_user_id uuid,
  actor_name text,
  changes jsonb,
  context jsonb
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'storage', 'extensions'
as $function$
declare
  v_order public.orders%rowtype;
  v_event public.app_entity_audit_log%rowtype;
  v_role text := lower(coalesce(public.user_role(), ''));
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 100));
  v_can_finance boolean := false;
  v_order_fields text[] := array[
    'title', 'status', 'assigned_to', 'client_id', 'object_id', 'work_type_id',
    'time_window_start', 'time_window_end', 'departure_time', 'arrival_at',
    'departure_at', 'duration_min', 'urgent', 'comment', 'address_mode',
    'country', 'region', 'city', 'street', 'house', 'postal_code', 'floor',
    'entrance', 'apartment', 'entrance_info', 'parking_notes', 'geo_lat',
    'geo_lng', 'district', 'tags', 'phone', 'completed_at', 'creation_source',
    'media_file_1', 'media_file_2', 'media_file_3', 'media_file_4', 'media_file_5'
  ];
  v_finance_order_fields text[] := array[
    'start_price', 'currency', 'payment_status', 'payment_method',
    'finance_money_holder', 'finance_scheme_disabled'
  ];
  v_finance_entry_fields text[] := array[
    'kind', 'title', 'note', 'calc_mode', 'input_amount', 'input_percent',
    'percent_base', 'calculated_amount', 'recipient_user_id', 'visibility_scope',
    'expense_payer'
  ];
  v_customer_payment_fields text[] := array[
    'amount', 'payment_method', 'paid_at', 'note', 'source', 'money_holder'
  ];
  v_allowed_fields text[];
  v_changed_fields text[];
  v_field text;
  v_before_value jsonb;
  v_after_value jsonb;
  v_before_ref jsonb;
  v_after_ref jsonb;
  v_changes jsonb;
  v_context jsonb;
  v_actor_name text;
  v_actor_first_name text;
  v_actor_middle_name text;
  v_actor_last_name text;
  v_initial_calculated_amount jsonb;
  v_initial_finance_effect jsonb;
  v_finance_snapshot jsonb;
  v_finance_calc_mode text;
begin
  if auth.uid() is null
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select o.* into v_order
  from public.orders o
  where o.id = p_order_id;

  if v_order.id is null then
    raise exception 'order was not found' using errcode = 'P0002';
  end if;

  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and not exists (
       select 1
       from public.companies company
       where company.id = v_order.company_id
         and company.order_history_enabled is true
     ) then
    raise exception 'order history feature is disabled' using errcode = '42501';
  end if;

  if not public.can_current_user_view_order(
    v_order.company_id,
    v_order.assigned_to,
    v_order.created_by_user_id,
    v_order.status
  ) then
    raise exception 'order activity access denied' using errcode = '42501';
  end if;

  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and v_role <> 'admin'
     and not public.current_user_has_app_permission(
       'canViewOrderHistory',
       public.order_permission_default(v_role, 'canViewOrderHistory')
     ) then
    raise exception 'order activity permission is disabled' using errcode = '42501';
  end if;

  v_can_finance :=
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or public.current_user_has_app_permission(
      'canViewFinanceAll',
      public.finance_permission_default(v_role, 'canViewFinanceAll')
    );

  if v_can_finance then
    v_order_fields := v_order_fields || v_finance_order_fields;
  end if;

  for v_event in
    select a.*
    from public.app_entity_audit_log a
    where a.company_id = v_order.company_id
      and a.order_id = p_order_id
      and (
        p_before_created_at is null
        or (a.created_at, a.id) < (p_before_created_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
      )
      and (
        (
          a.entity_type = 'orders'
          and (
            a.action <> 'update'
            or exists (
              select 1
              from unnest(coalesce(a.changed_fields, '{}'::text[])) changed(field)
              where changed.field = any(v_order_fields)
                and public.order_activity_value_is_distinct(
                  a.before_data -> changed.field,
                  a.after_data -> changed.field
                )
            )
          )
        )
        or (
          v_can_finance
          and a.entity_type = 'order_finance_entries'
          and (
            a.action <> 'update'
            or exists (
              select 1
              from unnest(coalesce(a.changed_fields, '{}'::text[])) changed(field)
              where changed.field = any(v_finance_entry_fields)
                and public.order_activity_value_is_distinct(
                  a.before_data -> changed.field,
                  a.after_data -> changed.field
                )
                and not (
                  (
                    lower(coalesce(a.after_data->>'calc_mode', a.before_data->>'calc_mode', 'fixed')) = 'fixed'
                    and changed.field = any(array['input_percent', 'percent_base']::text[])
                  )
                  or (
                    lower(coalesce(a.after_data->>'calc_mode', a.before_data->>'calc_mode', 'fixed')) = 'percent'
                    and changed.field = 'input_amount'
                  )
                  or (
                    lower(coalesce(a.after_data->>'calc_mode', a.before_data->>'calc_mode', 'fixed')) = 'fixed'
                    and changed.field = 'calculated_amount'
                    and 'input_amount' = any(coalesce(a.changed_fields, '{}'::text[]))
                    and public.order_activity_value_is_distinct(
                      a.before_data -> 'input_amount',
                      a.after_data -> 'input_amount'
                    )
                  )
                )
            )
          )
        )
        or (
          v_can_finance
          and a.entity_type = 'order_customer_payments'
          and (
            a.action <> 'update'
            or exists (
              select 1
              from unnest(coalesce(a.changed_fields, '{}'::text[])) changed(field)
              where changed.field = any(v_customer_payment_fields)
                and public.order_activity_value_is_distinct(
                  a.before_data -> changed.field,
                  a.after_data -> changed.field
                )
            )
          )
        )
      )
      and not (
        a.entity_type = 'order_finance_entries'
        and a.action = 'update'
        and cardinality(coalesce(a.changed_fields, '{}'::text[])) > 0
        and coalesce(a.changed_fields, '{}'::text[])
          <@ array['calculated_amount', 'finance_effect']::text[]
        and exists (
          select 1
          from public.app_entity_audit_log inserted
          where inserted.company_id = a.company_id
            and inserted.order_id = a.order_id
            and inserted.entity_type = 'order_finance_entries'
            and inserted.entity_id = a.entity_id
            and inserted.action = 'insert'
            and inserted.created_at = a.created_at
        )
      )
    order by a.created_at desc, a.id desc
    limit v_limit
  loop
    if v_event.entity_type = 'order_finance_entries' and v_event.action = 'insert' then
      select
        (
          select initialized.after_data -> 'calculated_amount'
          from public.app_entity_audit_log initialized
          where initialized.company_id = v_event.company_id
            and initialized.order_id = v_event.order_id
            and initialized.entity_type = 'order_finance_entries'
            and initialized.entity_id = v_event.entity_id
            and initialized.action = 'update'
            and initialized.created_at = v_event.created_at
            and 'calculated_amount' = any(coalesce(initialized.changed_fields, '{}'::text[]))
          order by initialized.id desc
          limit 1
        ),
        (
          select initialized.after_data -> 'finance_effect'
          from public.app_entity_audit_log initialized
          where initialized.company_id = v_event.company_id
            and initialized.order_id = v_event.order_id
            and initialized.entity_type = 'order_finance_entries'
            and initialized.entity_id = v_event.entity_id
            and initialized.action = 'update'
            and initialized.created_at = v_event.created_at
            and 'finance_effect' = any(coalesce(initialized.changed_fields, '{}'::text[]))
          order by initialized.id desc
          limit 1
        )
      into v_initial_calculated_amount, v_initial_finance_effect;

      if v_initial_calculated_amount is not null then
        v_event.after_data := coalesce(v_event.after_data, '{}'::jsonb)
          || jsonb_build_object('calculated_amount', v_initial_calculated_amount);
      end if;
      if v_initial_finance_effect is not null then
        v_event.after_data := coalesce(v_event.after_data, '{}'::jsonb)
          || jsonb_build_object('finance_effect', v_initial_finance_effect);
      end if;
    end if;

    if v_event.entity_type = 'orders' then
      v_allowed_fields := v_order_fields;
    elsif v_event.entity_type = 'order_finance_entries' then
      v_allowed_fields := v_finance_entry_fields;
    else
      v_allowed_fields := v_customer_payment_fields;
    end if;

    v_finance_snapshot := coalesce(v_event.after_data, v_event.before_data, '{}'::jsonb);
    v_finance_calc_mode := lower(coalesce(v_finance_snapshot->>'calc_mode', 'fixed'));

    if v_event.action = 'update' then
      select coalesce(array_agg(f order by f), '{}'::text[])
      into v_changed_fields
      from unnest(coalesce(v_event.changed_fields, '{}'::text[])) f
      where f = any(v_allowed_fields)
        and public.order_activity_value_is_distinct(
          v_event.before_data -> f,
          v_event.after_data -> f
        )
        and not (
          v_event.entity_type = 'order_finance_entries'
          and (
            (v_finance_calc_mode = 'fixed' and f = any(array['input_percent', 'percent_base']::text[]))
            or (v_finance_calc_mode = 'percent' and f = 'input_amount')
            or (
              v_finance_calc_mode = 'fixed'
              and f = 'calculated_amount'
              and 'input_amount' = any(coalesce(v_event.changed_fields, '{}'::text[]))
              and public.order_activity_value_is_distinct(
                v_event.before_data -> 'input_amount',
                v_event.after_data -> 'input_amount'
              )
            )
          )
        );
    elsif v_event.entity_type = 'orders' then
      v_changed_fields := '{}'::text[];
    elsif v_event.entity_type = 'order_finance_entries' then
      select coalesce(array_agg(f order by array_position(v_allowed_fields, f)), '{}'::text[])
      into v_changed_fields
      from unnest(v_allowed_fields) f
      where v_finance_snapshot ? f
        and (
          f = any(array['kind', 'title', 'calc_mode', 'visibility_scope']::text[])
          or
          (f = 'note' and nullif(btrim(v_finance_snapshot->>f), '') is not null)
          or (
            v_finance_calc_mode = 'fixed'
            and f = 'input_amount'
          )
          or (
            v_finance_calc_mode = 'percent'
            and f = any(array['input_percent', 'percent_base', 'calculated_amount']::text[])
          )
          or (
            f = 'recipient_user_id'
            and nullif(v_finance_snapshot->>f, '') is not null
          )
          or (
            f = 'expense_payer'
            and lower(coalesce(v_finance_snapshot->>'kind', '')) = 'expense'
          )
        );
    else
      select coalesce(array_agg(f order by array_position(v_allowed_fields, f)), '{}'::text[])
      into v_changed_fields
      from unnest(v_allowed_fields) f
      where coalesce(v_event.after_data, v_event.before_data, '{}'::jsonb) ? f;
    end if;

    if v_event.action = 'update' and cardinality(v_changed_fields) = 0 then
      continue;
    end if;

    v_changes := '[]'::jsonb;
    foreach v_field in array v_changed_fields
    loop
      v_before_value := v_event.before_data -> v_field;
      v_after_value := v_event.after_data -> v_field;
      v_before_ref := null;
      v_after_ref := null;

      if v_field = 'phone' then
        v_before_value := null;
        v_after_value := null;
      elsif v_field like 'media_file_%' then
        v_before_value := to_jsonb(case
          when jsonb_typeof(v_event.before_data -> v_field) = 'array'
            then jsonb_array_length(v_event.before_data -> v_field)
          else 0
        end);
        v_after_value := to_jsonb(case
          when jsonb_typeof(v_event.after_data -> v_field) = 'array'
            then jsonb_array_length(v_event.after_data -> v_field)
          else 0
        end);
      else
        v_before_ref := public.order_activity_value_ref(v_field, v_before_value, v_order.company_id);
        v_after_ref := public.order_activity_value_ref(v_field, v_after_value, v_order.company_id);
      end if;

      v_changes := v_changes || jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object(
          'field', v_field,
          'before', v_before_value,
          'after', v_after_value,
          'before_ref', v_before_ref,
          'after_ref', v_after_ref,
          'redacted', v_field = 'phone',
          'value_type', case
            when v_field like 'media_file_%' then 'media_count'
            when v_before_ref is not null or v_after_ref is not null then 'reference'
            else 'scalar'
          end
        ))
      );
    end loop;

    select
      coalesce(
        nullif(btrim(p.full_name), ''),
        nullif(btrim(concat_ws(' ', p.first_name, p.middle_name, p.last_name)), ''),
        ''
      ),
      nullif(btrim(p.first_name), ''),
      nullif(btrim(p.middle_name), ''),
      nullif(btrim(p.last_name), '')
    into v_actor_name, v_actor_first_name, v_actor_middle_name, v_actor_last_name
    from public.profiles p
    where p.id = v_event.actor_user_id
      and p.company_id = v_order.company_id;

    v_context := jsonb_strip_nulls(jsonb_build_object(
      'entity_id', v_event.entity_id,
      'actor', case
        when v_event.actor_user_id is null then null
        else jsonb_strip_nulls(jsonb_build_object(
          'first_name', v_actor_first_name,
          'middle_name', v_actor_middle_name,
          'last_name', v_actor_last_name
        ))
      end,
      'client', public.order_activity_value_ref(
        'client_id',
        coalesce(v_event.after_data->'client_id', v_event.before_data->'client_id'),
        v_order.company_id
      ),
      'object', public.order_activity_value_ref(
        'object_id',
        coalesce(v_event.after_data->'object_id', v_event.before_data->'object_id'),
        v_order.company_id
      ),
      'assignee', public.order_activity_value_ref(
        'assigned_to',
        coalesce(v_event.after_data->'assigned_to', v_event.before_data->'assigned_to'),
        v_order.company_id
      ),
      'title', coalesce(v_event.after_data->>'title', v_event.before_data->>'title'),
      'currency', case
        when v_can_finance then coalesce(
          v_event.after_data->>'currency',
          v_event.before_data->>'currency',
          v_order.currency,
          'RUB'
        )
        else null
      end,
      'amount', case
        when v_can_finance and v_event.entity_type = 'order_finance_entries'
          then coalesce(v_event.after_data->'calculated_amount', v_event.before_data->'calculated_amount')
        when v_can_finance and v_event.entity_type = 'order_customer_payments'
          then coalesce(v_event.after_data->'amount', v_event.before_data->'amount')
        else null
      end
    ));

    event_id := v_event.id;
    occurred_at := v_event.created_at;
    action := v_event.action;
    entity_type := v_event.entity_type;
    actor_user_id := v_event.actor_user_id;
    actor_name := v_actor_name;
    changes := v_changes;
    context := v_context;
    return next;
  end loop;
end;
$function$;

revoke all on function public.get_order_activity(uuid, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.get_order_activity(uuid, integer, timestamptz, uuid)
  to authenticated, service_role;

-- Make the new RPC visible to PostgREST immediately after deployment.
notify pgrst, 'reload schema';
