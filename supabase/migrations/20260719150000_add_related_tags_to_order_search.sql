begin;

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
  nullif(concat_ws(', ', co.city, co.street, co.house), '') as object_summary,
  coalesce((
    select array_agg(distinct tag.value order by tag.value)
    from public.client_tag_links link
    join public.company_tags tag on tag.id = link.tag_id
    where link.client_id = o.client_id
      and link.company_id = o.company_id
      and tag.company_id = o.company_id
      and tag.tag_type = 'client'
  ), '{}'::text[]) as client_tags,
  coalesce((
    select array_agg(distinct tag.value order by tag.value)
    from public.object_tag_links link
    join public.company_tags tag on tag.id = link.tag_id
    where link.object_id = o.object_id
      and link.company_id = o.company_id
      and tag.company_id = o.company_id
      and tag.tag_type = 'object'
  ), '{}'::text[]) as object_tags
from public.orders o
left join public.clients c on c.id = o.client_id
left join public.client_objects co on co.id = o.object_id
where public.can_current_user_view_order(o.company_id, o.assigned_to, o.created_by_user_id, o.status);

grant select on public.orders_accessible to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
