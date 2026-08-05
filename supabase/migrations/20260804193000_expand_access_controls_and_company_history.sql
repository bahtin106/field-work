begin;

-- Company history is a permanent audit capability. Solo owners keep their
-- explicit opt-in setting, while company accounts cannot disable the archive.
update public.companies
set order_history_enabled = true
where work_mode = 'company'
  and order_history_enabled is distinct from true;

create or replace function public.enforce_company_order_history_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.work_mode = 'company' then
    new.order_history_enabled := true;
  elsif tg_op = 'UPDATE' and old.work_mode = 'company' and new.work_mode = 'solo' then
    new.order_history_enabled := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_companies_enforce_order_history on public.companies;
create trigger trg_companies_enforce_order_history
before insert or update of work_mode, order_history_enabled
on public.companies
for each row execute function public.enforce_company_order_history_v1();

create or replace function public.set_company_order_history_enabled_v1(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_company_id uuid;
  v_work_mode text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if lower(coalesce(public.user_role(), '')) <> 'admin' then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;

  v_company_id := public.user_company_id();
  select company.work_mode
    into v_work_mode
  from public.companies company
  where company.id = v_company_id;

  if not found then
    raise exception 'Company is not accessible' using errcode = '42501';
  end if;
  if coalesce(v_work_mode, 'company') = 'company' then
    if coalesce(p_enabled, false) is not true then
      raise exception 'Order history is always enabled in company mode' using errcode = '42501';
    end if;
    update public.companies set order_history_enabled = true where id = v_company_id;
    return true;
  end if;

  update public.companies
     set order_history_enabled = coalesce(p_enabled, false)
   where id = v_company_id;
  return true;
end;
$$;

revoke all on function public.set_company_order_history_enabled_v1(boolean) from public, anon;
grant execute on function public.set_company_order_history_enabled_v1(boolean) to authenticated, service_role;

-- Canonical defaults for the complete role matrix shown in both clients.
create or replace function public.order_permission_default(p_role text, p_key text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, auth, storage, extensions
as $$
  select case
    when lower(coalesce(p_role, '')) = 'admin' then true
    when lower(coalesce(p_role, '')) = 'dispatcher' then p_key in (
      'canCreateOrders', 'canEditOrders', 'canCompleteOwnOrders', 'canCompleteOtherOrders',
      'canAssignExecutors', 'canViewAllOrders', 'canDeleteOrders',
      'canViewOrderPhotos', 'canAddGalleryPhotos', 'canAddCameraPhotos',
      'canViewOrderHistory', 'canViewOrderAmount', 'canEditOrderAmount'
    )
    when lower(coalesce(p_role, '')) = 'worker' then p_key in (
      'canViewOrderPhotos', 'canAddCameraPhotos', 'canViewOrderAmount'
    )
    else false
  end;
$$;

create or replace function public.has_app_role_permission(
  p_company_id uuid,
  p_role text,
  p_key text,
  p_default boolean
)
returns boolean
language sql
stable
set search_path = pg_catalog, public, auth, storage, extensions
as $$
  select case
    when lower(coalesce(p_role, '')) = 'admin' then true
    else coalesce(
      (
        select permission.value
        from public.app_role_permissions permission
        where permission.company_id = p_company_id
          and permission.role = p_role
          and permission.key = p_key
        limit 1
      ),
      coalesce(p_default, false)
    )
  end;
$$;

with roles(role) as (
  values ('admin'::text), ('dispatcher'::text), ('worker'::text)
), permission_keys(key, permission_group) as (
  values
    ('canCreateOrders'::text, 'orders'::text),
    ('canEditOrders', 'orders'),
    ('canCompleteOwnOrders', 'orders'),
    ('canCompleteOtherOrders', 'orders'),
    ('canAssignExecutors', 'orders'),
    ('canViewAllOrders', 'orders'),
    ('canDeleteOrders', 'orders'),
    ('canViewOrderPhotos', 'orders'),
    ('canAddGalleryPhotos', 'orders'),
    ('canAddCameraPhotos', 'orders'),
    ('canViewOrderHistory', 'orders'),
    ('canViewOrderAmount', 'orders'),
    ('canEditOrderAmount', 'orders'),
    ('canViewFinanceOwn', 'finance'),
    ('canViewFinanceAll', 'finance'),
    ('canEditFinanceEntries', 'finance'),
    ('canManageFinanceRules', 'finance'),
    ('canViewFinanceStatsAll', 'finance'),
    ('canViewClients', 'clients'),
    ('canViewClientPhones', 'clients'),
    ('canCreateClients', 'clients'),
    ('canEditClients', 'clients'),
    ('canDeleteClients', 'clients'),
    ('canViewObjects', 'objects'),
    ('canViewObjectPhones', 'objects'),
    ('canCreateObjects', 'objects'),
    ('canEditObjects', 'objects'),
    ('canDeleteObjects', 'objects'),
    ('canViewTrash', 'trash'),
    ('canRestoreTrash', 'trash'),
    ('canPurgeTrash', 'trash')
)
insert into public.app_role_permissions (company_id, role, key, value)
select
  company.id,
  role_row.role,
  key_row.key,
  case key_row.permission_group
    when 'orders' then public.order_permission_default(role_row.role, key_row.key)
    when 'finance' then public.finance_permission_default(role_row.role, key_row.key)
    when 'clients' then public.clients_permission_default(role_row.role, key_row.key)
    when 'objects' then public.object_permission_default(role_row.role, key_row.key)
    when 'trash' then public.trash_permission_default(role_row.role, key_row.key)
    else false
  end
from public.companies company
cross join roles role_row
cross join permission_keys key_row
on conflict (company_id, role, key) do nothing;

update public.app_role_permissions
set value = true
where role = 'admin'
  and key in (
    'canCreateOrders', 'canEditOrders', 'canCompleteOwnOrders', 'canCompleteOtherOrders',
    'canAssignExecutors', 'canViewAllOrders', 'canDeleteOrders',
    'canViewOrderPhotos', 'canAddGalleryPhotos', 'canAddCameraPhotos', 'canViewOrderHistory',
    'canViewOrderAmount', 'canEditOrderAmount', 'canViewFinanceOwn', 'canViewFinanceAll',
    'canEditFinanceEntries', 'canManageFinanceRules', 'canViewFinanceStatsAll',
    'canViewClients', 'canViewClientPhones', 'canCreateClients', 'canEditClients',
    'canDeleteClients', 'canViewObjects', 'canViewObjectPhones', 'canCreateObjects',
    'canEditObjects', 'canDeleteObjects', 'canViewTrash', 'canRestoreTrash', 'canPurgeTrash'
  );

-- Enforce client and object permissions on direct table access as well as UI.
drop policy if exists clients_select_company on public.clients;
create policy clients_select_company on public.clients
for select to authenticated
using (
  company_id = public.user_company_id()
  and public.has_app_role_permission(
    company_id, public.user_role(), 'canViewClients',
    public.clients_permission_default(public.user_role(), 'canViewClients')
  )
);

drop policy if exists clients_insert_company on public.clients;
create policy clients_insert_company on public.clients
for insert to authenticated
with check (
  company_id = public.user_company_id()
  and public.has_app_role_permission(
    company_id, public.user_role(), 'canCreateClients',
    public.clients_permission_default(public.user_role(), 'canCreateClients')
  )
);

drop policy if exists client_objects_select_company on public.client_objects;
create policy client_objects_select_company on public.client_objects
for select to authenticated
using (
  company_id = public.user_company_id()
  and public.has_app_role_permission(
    company_id, public.user_role(), 'canViewObjects',
    public.object_permission_default(public.user_role(), 'canViewObjects')
  )
);

drop policy if exists client_objects_insert_company on public.client_objects;
create policy client_objects_insert_company on public.client_objects
for insert to authenticated
with check (
  company_id = public.user_company_id()
  and public.has_app_role_permission(
    company_id, public.user_role(), 'canCreateObjects',
    public.object_permission_default(public.user_role(), 'canCreateObjects')
  )
);

create or replace view public.clients_secure_including_trash_v1
with (security_barrier = true)
as
select
  c.id, c.company_id, c.first_name, c.last_name, c.middle_name, c.full_name, c.email,
  case when public.current_user_has_app_permission(
    'canViewClientPhones', public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then c.phone else null end as phone,
  c.avatar_url, c.created_at, c.updated_at, c.created_by, c.updated_by,
  case when public.current_user_has_app_permission(
    'canViewClientPhones', public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then c.additional_phone_1 else null end as additional_phone_1,
  case when public.current_user_has_app_permission(
    'canViewClientPhones', public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then c.additional_phone_1_label else null end as additional_phone_1_label,
  case when public.current_user_has_app_permission(
    'canViewClientPhones', public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then c.additional_phone_2 else null end as additional_phone_2,
  case when public.current_user_has_app_permission(
    'canViewClientPhones', public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then c.additional_phone_2_label else null end as additional_phone_2_label,
  case when public.current_user_has_app_permission(
    'canViewClientPhones', public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then c.additional_phone_3 else null end as additional_phone_3,
  case when public.current_user_has_app_permission(
    'canViewClientPhones', public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then c.additional_phone_3_label else null end as additional_phone_3_label,
  c.comment
from public.clients c
where coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
   or (
     c.company_id = public.user_company_id()
     and public.current_user_has_app_permission(
       'canViewClients', public.clients_permission_default(public.user_role(), 'canViewClients')
     )
   );

create or replace view public.client_objects_secure_including_trash_v1
with (security_barrier = true)
as
select
  o.id, o.client_id, o.company_id, o.name, o.is_primary,
  o.country, o.region, o.city, o.street, o.house, o.postal_code,
  o.floor, o.entrance, o.apartment, o.geo_lat, o.geo_lng,
  o.created_at, o.updated_at, o.created_by, o.updated_by, o.photo_url, o.district,
  case when public.current_user_has_app_permission(
    'canViewObjectPhones', public.object_permission_default(public.user_role(), 'canViewObjectPhones')
  ) then o.additional_phone_1 else null end as additional_phone_1,
  case when public.current_user_has_app_permission(
    'canViewObjectPhones', public.object_permission_default(public.user_role(), 'canViewObjectPhones')
  ) then o.additional_phone_1_label else null end as additional_phone_1_label,
  case when public.current_user_has_app_permission(
    'canViewObjectPhones', public.object_permission_default(public.user_role(), 'canViewObjectPhones')
  ) then o.additional_phone_2 else null end as additional_phone_2,
  case when public.current_user_has_app_permission(
    'canViewObjectPhones', public.object_permission_default(public.user_role(), 'canViewObjectPhones')
  ) then o.additional_phone_2_label else null end as additional_phone_2_label,
  case when public.current_user_has_app_permission(
    'canViewObjectPhones', public.object_permission_default(public.user_role(), 'canViewObjectPhones')
  ) then o.additional_phone_3 else null end as additional_phone_3,
  case when public.current_user_has_app_permission(
    'canViewObjectPhones', public.object_permission_default(public.user_role(), 'canViewObjectPhones')
  ) then o.additional_phone_3_label else null end as additional_phone_3_label,
  o.media_file_1, o.media_file_2, o.media_file_3, o.location_mode, o.comment,
  o.media_file_1_label, o.media_file_2_label, o.media_file_3_label, o.media_sections
from public.client_objects o
where coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
   or (
     o.company_id = public.user_company_id()
     and public.current_user_has_app_permission(
       'canViewObjects', public.object_permission_default(public.user_role(), 'canViewObjects')
     )
   );

grant select on public.clients_secure_including_trash_v1,
  public.client_objects_secure_including_trash_v1 to authenticated, service_role;

create or replace function public.can_current_user_view_order_finance_v1(p_assigned_to uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public, auth
as $$
  select
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or lower(coalesce(public.user_role(), '')) = 'admin'
    or public.current_user_has_app_permission(
      'canViewFinanceAll', public.finance_permission_default(public.user_role(), 'canViewFinanceAll')
    )
    or (
      p_assigned_to = auth.uid()
      and public.current_user_has_app_permission(
        'canViewFinanceOwn', public.finance_permission_default(public.user_role(), 'canViewFinanceOwn')
      )
    );
$$;

create or replace view public.orders_accessible_including_trash_v1
with (security_barrier = true)
as
select
  o.id, o.created_at, o.comment, o.status,
  case when public.current_user_has_app_permission(
    'canViewOrderPhotos', public.order_permission_default(public.user_role(), 'canViewOrderPhotos')
  ) then o.media_file_1 else '{}'::text[] end as media_file_1,
  case when public.current_user_has_app_permission(
    'canViewOrderPhotos', public.order_permission_default(public.user_role(), 'canViewOrderPhotos')
  ) then o.media_file_2 else '{}'::text[] end as media_file_2,
  case when public.current_user_has_app_permission(
    'canViewOrderPhotos', public.order_permission_default(public.user_role(), 'canViewOrderPhotos')
  ) then o.media_file_3 else '{}'::text[] end as media_file_3,
  case when public.current_user_has_app_permission(
    'canViewOrderPhotos', public.order_permission_default(public.user_role(), 'canViewOrderPhotos')
  ) then o.media_file_4 else '{}'::text[] end as media_file_4,
  o.assigned_to, o.title, o.urgent,
  case when public.current_user_has_app_permission(
    'canViewOrderAmount', public.order_permission_default(public.user_role(), 'canViewOrderAmount')
  ) then o.start_price else null end as start_price,
  o.company_id, o.time_window_start, o.time_window_end, o.duration_min,
  o.arrival_at, o.departure_at, o.tags,
  case when public.can_current_user_view_order_finance_v1(o.assigned_to)
    then o.payment_status else null end as payment_status,
  o.updated_at,
  o.completed_at, o.work_type_id, o.currency, o.created_by_user_id,
  o.feed_entered_at, o.client_id, o.object_id, o.address_mode, o.country,
  o.region, o.city, o.street, o.house, o.postal_code, o.floor, o.entrance,
  o.apartment, o.entrance_info, o.parking_notes, o.geo_lat, o.geo_lng,
  o.district,
  case when public.can_current_user_view_order_finance_v1(o.assigned_to)
    then o.payment_method else null end as payment_method,
  case when public.current_user_has_app_permission(
    'canViewOrderPhotos', public.order_permission_default(public.user_role(), 'canViewOrderPhotos')
  ) then o.media_file_5 else '{}'::text[] end as media_file_5,
  o.departure_time, o.creation_source,
  case when public.can_current_user_view_order_finance_v1(o.assigned_to)
    then o.finance_income_total else null end as finance_income_total,
  case when public.can_current_user_view_order_finance_v1(o.assigned_to)
    then o.finance_expense_total else null end as finance_expense_total,
  case when public.can_current_user_view_order_finance_v1(o.assigned_to)
    then o.finance_discount_total else null end as finance_discount_total,
  case when public.can_current_user_view_order_finance_v1(o.assigned_to)
    then o.finance_gross_total else null end as finance_gross_total,
  case when public.can_current_user_view_order_finance_v1(o.assigned_to)
    then o.finance_net_total else null end as finance_net_total,
  case when public.can_current_user_view_order_finance_v1(o.assigned_to)
    then o.finance_calculated_at else null end as finance_calculated_at,
  case
    when public.current_user_has_app_permission(
      'canViewClientPhones', public.clients_permission_default(public.user_role(), 'canViewClientPhones')
    ) and public.can_view_order_phone(
      o.company_id, o.assigned_to, o.time_window_start, o.departure_at,
      o.status, o.updated_at, o.departure_time
    ) then o.phone
    else null
  end as phone,
  case when public.current_user_has_app_permission(
    'canViewClients', public.clients_permission_default(public.user_role(), 'canViewClients')
  ) then nullif(concat_ws(' ', c.last_name, c.first_name, c.middle_name), '') else null end as fio,
  case when public.current_user_has_app_permission(
    'canViewObjects', public.object_permission_default(public.user_role(), 'canViewObjects')
  ) then co.name else null end as object_name,
  case when public.current_user_has_app_permission(
    'canViewObjects', public.object_permission_default(public.user_role(), 'canViewObjects')
  ) then nullif(concat_ws(', ', co.city, co.street, co.house), '') else null end as object_summary,
  case when public.current_user_has_app_permission(
    'canViewClients', public.clients_permission_default(public.user_role(), 'canViewClients')
  ) then coalesce((
    select array_agg(distinct tag.value order by tag.value)
    from public.client_tag_links link
    join public.company_tags tag on tag.id = link.tag_id
    where link.client_id = o.client_id
      and link.company_id = o.company_id
      and tag.company_id = o.company_id
      and tag.tag_type = 'client'
  ), '{}'::text[]) else '{}'::text[] end as client_tags,
  case when public.current_user_has_app_permission(
    'canViewObjects', public.object_permission_default(public.user_role(), 'canViewObjects')
  ) then coalesce((
    select array_agg(distinct tag.value order by tag.value)
    from public.object_tag_links link
    join public.company_tags tag on tag.id = link.tag_id
    where link.object_id = o.object_id
      and link.company_id = o.company_id
      and tag.company_id = o.company_id
      and tag.tag_type = 'object'
  ), '{}'::text[]) else '{}'::text[] end as object_tags
from public.orders o
left join public.clients c on c.id = o.client_id
left join public.client_objects co on co.id = o.object_id
where public.can_current_user_view_order(o.company_id, o.assigned_to, o.created_by_user_id, o.status);

grant select on public.orders_accessible_including_trash_v1 to authenticated, service_role;

create or replace view public.orders_accessible
with (security_barrier = true)
as
select
  source.*,
  case when public.current_user_has_app_permission(
    'canViewObjects', public.object_permission_default(public.user_role(), 'canViewObjects')
  ) then co.location_mode else null end as object_location_mode
from public.orders_accessible_including_trash_v1 source
left join public.client_objects co
  on co.id = source.object_id
 and co.company_id = source.company_id
where not exists (
  select 1
  from public.trash_entries trash
  where trash.entity_type = 'order'
    and trash.entity_id = source.id
);

grant select on public.orders_accessible to authenticated, service_role;

-- Protect granular order fields even when a caller bypasses the application UI.
create or replace function public.orders_enforce_granular_access_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public, auth
as $$
declare
  v_role text := lower(coalesce(public.user_role(), ''));
  v_user_id uuid := auth.uid();
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     or v_role = 'admin' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.start_price is not null and not public.current_user_has_app_permission(
      'canEditOrderAmount', public.order_permission_default(v_role, 'canEditOrderAmount')
    ) then
      raise exception 'Order amount edit denied' using errcode = '42501';
    end if;
    if new.assigned_to is not null and not public.current_user_has_app_permission(
      'canAssignExecutors', public.order_permission_default(v_role, 'canAssignExecutors')
    ) then
      raise exception 'Order assignment denied' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.start_price is distinct from old.start_price and not public.current_user_has_app_permission(
    'canEditOrderAmount', public.order_permission_default(v_role, 'canEditOrderAmount')
  ) then
    raise exception 'Order amount edit denied' using errcode = '42501';
  end if;

  if new.assigned_to is distinct from old.assigned_to
     and not (
       (old.assigned_to is null and new.assigned_to = v_user_id)
       or (old.assigned_to = v_user_id and new.assigned_to is null)
     )
     and not public.current_user_has_app_permission(
       'canAssignExecutors', public.order_permission_default(v_role, 'canAssignExecutors')
     ) then
    raise exception 'Order assignment denied' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_enforce_granular_access on public.orders;
create trigger trg_orders_enforce_granular_access
before insert or update of assigned_to, start_price
on public.orders
for each row execute function public.orders_enforce_granular_access_v1();

notify pgrst, 'reload schema';

commit;
