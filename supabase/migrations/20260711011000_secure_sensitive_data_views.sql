begin;

create or replace view public.clients_secure
with (security_barrier = true)
as
select
  c.id,
  c.company_id,
  c.first_name,
  c.last_name,
  c.middle_name,
  c.full_name,
  c.email,
  case when public.current_user_has_app_permission(
    'canViewClientPhones',
    public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then c.phone else null end as phone,
  c.avatar_url,
  c.created_at,
  c.updated_at,
  c.created_by,
  c.updated_by,
  case when public.current_user_has_app_permission(
    'canViewClientPhones',
    public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then c.additional_phone_1 else null end as additional_phone_1,
  case when public.current_user_has_app_permission(
    'canViewClientPhones',
    public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then c.additional_phone_1_label else null end as additional_phone_1_label,
  case when public.current_user_has_app_permission(
    'canViewClientPhones',
    public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then c.additional_phone_2 else null end as additional_phone_2,
  case when public.current_user_has_app_permission(
    'canViewClientPhones',
    public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then c.additional_phone_2_label else null end as additional_phone_2_label,
  case when public.current_user_has_app_permission(
    'canViewClientPhones',
    public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then c.additional_phone_3 else null end as additional_phone_3,
  case when public.current_user_has_app_permission(
    'canViewClientPhones',
    public.clients_permission_default(public.user_role(), 'canViewClientPhones')
  ) then c.additional_phone_3_label else null end as additional_phone_3_label,
  c.comment
from public.clients c
where coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
   or c.company_id = public.user_company_id();

create or replace view public.client_objects_secure
with (security_barrier = true)
as
select
  o.id,
  o.client_id,
  o.company_id,
  o.name,
  o.is_primary,
  o.country,
  o.region,
  o.city,
  o.street,
  o.house,
  o.postal_code,
  o.floor,
  o.entrance,
  o.apartment,
  o.geo_lat,
  o.geo_lng,
  o.created_at,
  o.updated_at,
  o.created_by,
  o.updated_by,
  o.photo_url,
  o.district,
  case when public.current_user_has_app_permission(
    'canViewObjectPhones',
    public.object_permission_default(public.user_role(), 'canViewObjectPhones')
  ) then o.additional_phone_1 else null end as additional_phone_1,
  case when public.current_user_has_app_permission(
    'canViewObjectPhones',
    public.object_permission_default(public.user_role(), 'canViewObjectPhones')
  ) then o.additional_phone_1_label else null end as additional_phone_1_label,
  case when public.current_user_has_app_permission(
    'canViewObjectPhones',
    public.object_permission_default(public.user_role(), 'canViewObjectPhones')
  ) then o.additional_phone_2 else null end as additional_phone_2,
  case when public.current_user_has_app_permission(
    'canViewObjectPhones',
    public.object_permission_default(public.user_role(), 'canViewObjectPhones')
  ) then o.additional_phone_2_label else null end as additional_phone_2_label,
  case when public.current_user_has_app_permission(
    'canViewObjectPhones',
    public.object_permission_default(public.user_role(), 'canViewObjectPhones')
  ) then o.additional_phone_3 else null end as additional_phone_3,
  case when public.current_user_has_app_permission(
    'canViewObjectPhones',
    public.object_permission_default(public.user_role(), 'canViewObjectPhones')
  ) then o.additional_phone_3_label else null end as additional_phone_3_label,
  o.media_file_1,
  o.media_file_2,
  o.media_file_3,
  o.location_mode,
  o.comment,
  o.media_file_1_label,
  o.media_file_2_label,
  o.media_file_3_label,
  o.media_sections
from public.client_objects o
where coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
   or o.company_id = public.user_company_id();

create or replace view public.orders_accessible
with (security_barrier = true)
as
select
  o.id,
  o.created_at,
  o.comment,
  o.status,
  case when public.current_user_has_app_permission(
    'canViewOrderPhotos',
    public.order_permission_default(public.user_role(), 'canViewOrderPhotos')
  ) then o.media_file_1 else '{}'::text[] end as media_file_1,
  case when public.current_user_has_app_permission(
    'canViewOrderPhotos',
    public.order_permission_default(public.user_role(), 'canViewOrderPhotos')
  ) then o.media_file_2 else '{}'::text[] end as media_file_2,
  case when public.current_user_has_app_permission(
    'canViewOrderPhotos',
    public.order_permission_default(public.user_role(), 'canViewOrderPhotos')
  ) then o.media_file_3 else '{}'::text[] end as media_file_3,
  case when public.current_user_has_app_permission(
    'canViewOrderPhotos',
    public.order_permission_default(public.user_role(), 'canViewOrderPhotos')
  ) then o.media_file_4 else '{}'::text[] end as media_file_4,
  o.assigned_to,
  o.title,
  o.urgent,
  case when public.current_user_has_app_permission(
    'canViewFinanceAll',
    public.finance_permission_default(public.user_role(), 'canViewFinanceAll')
  ) then o.start_price else null end as start_price,
  o.company_id,
  o.time_window_start,
  o.time_window_end,
  o.duration_min,
  o.arrival_at,
  o.departure_at,
  o.tags,
  o.payment_status,
  o.updated_at,
  o.completed_at,
  o.work_type_id,
  o.currency,
  o.created_by_user_id,
  o.feed_entered_at,
  o.client_id,
  o.object_id,
  o.address_mode,
  o.country,
  o.region,
  o.city,
  o.street,
  o.house,
  o.postal_code,
  o.floor,
  o.entrance,
  o.apartment,
  o.entrance_info,
  o.parking_notes,
  o.geo_lat,
  o.geo_lng,
  o.district,
  o.payment_method,
  case when public.current_user_has_app_permission(
    'canViewOrderPhotos',
    public.order_permission_default(public.user_role(), 'canViewOrderPhotos')
  ) then o.media_file_5 else '{}'::text[] end as media_file_5,
  o.departure_time,
  o.creation_source,
  case when public.current_user_has_app_permission(
    'canViewFinanceAll',
    public.finance_permission_default(public.user_role(), 'canViewFinanceAll')
  ) then o.finance_income_total else null end as finance_income_total,
  case when public.current_user_has_app_permission(
    'canViewFinanceAll',
    public.finance_permission_default(public.user_role(), 'canViewFinanceAll')
  ) then o.finance_expense_total else null end as finance_expense_total,
  case when public.current_user_has_app_permission(
    'canViewFinanceAll',
    public.finance_permission_default(public.user_role(), 'canViewFinanceAll')
  ) then o.finance_discount_total else null end as finance_discount_total,
  case when public.current_user_has_app_permission(
    'canViewFinanceAll',
    public.finance_permission_default(public.user_role(), 'canViewFinanceAll')
  ) then o.finance_gross_total else null end as finance_gross_total,
  case when public.current_user_has_app_permission(
    'canViewFinanceAll',
    public.finance_permission_default(public.user_role(), 'canViewFinanceAll')
  ) then o.finance_net_total else null end as finance_net_total,
  case when public.current_user_has_app_permission(
    'canViewFinanceAll',
    public.finance_permission_default(public.user_role(), 'canViewFinanceAll')
  ) then o.finance_calculated_at else null end as finance_calculated_at,
  case
    when public.current_user_has_app_permission(
      'canViewClientPhones',
      public.clients_permission_default(public.user_role(), 'canViewClientPhones')
    ) and public.can_view_order_phone(
      o.company_id, o.assigned_to, o.time_window_start, o.departure_at, o.status, o.updated_at, o.departure_time
    ) then o.phone
    else null
  end as phone,
  nullif(concat_ws(' ', c.last_name, c.first_name, c.middle_name), '') as fio,
  co.name as object_name,
  nullif(concat_ws(', ', co.city, co.street, co.house), '') as object_summary
from public.orders o
left join public.clients c on c.id = o.client_id
left join public.client_objects co on co.id = o.object_id
where public.can_current_user_view_order(o.company_id, o.assigned_to, o.created_by_user_id, o.status);

revoke select on table public.clients from authenticated;
revoke select on table public.client_objects from authenticated;
revoke select on table public.orders from authenticated;

grant select (id, company_id) on table public.clients to authenticated;
grant select (
  id, client_id, company_id, name, is_primary, country, region, city,
  street, house, apartment
) on table public.client_objects to authenticated;
grant select (id, company_id, assigned_to, created_by_user_id, status, updated_at, work_type_id, client_id, object_id)
  on table public.orders to authenticated;

grant select on public.clients_secure, public.client_objects_secure, public.orders_accessible
  to authenticated, service_role;

revoke all on public.orders_secure, public.orders_secure_v2 from authenticated, anon;

commit;
