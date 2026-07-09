-- Close Supabase advisor warnings and tune the hottest background queries without
-- changing application-facing data contracts.

alter function public.set_user_marketing_preferences_updated_at()
  set search_path = public, pg_temp;
alter function public.media_assets_provider_from_url(text, text)
  set search_path = public, pg_temp;
alter function public.media_assets_storage_bucket_from_url(text)
  set search_path = public, pg_temp;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'registration_email_codes',
    'registration_email_proofs'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format('alter table public.%I enable row level security', target_table);
      execute format('revoke all on table public.%I from anon, authenticated, public', target_table);
      execute format('grant all on table public.%I to service_role', target_table);

      if not exists (
        select 1
          from pg_policies
         where schemaname = 'public'
           and tablename = target_table
           and policyname = target_table || '_service_role_all'
      ) then
        execute format(
          'create policy %I on public.%I for all to service_role using (true) with check (true)',
          target_table || '_service_role_all',
          target_table
        );
      end if;
    end if;
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in
    select c.relname as partition_name
      from pg_inherits i
      join pg_class p on p.oid = i.inhparent
      join pg_namespace pn on pn.oid = p.relnamespace
      join pg_class c on c.oid = i.inhrelid
      join pg_namespace cn on cn.oid = c.relnamespace
     where pn.nspname = 'public'
       and p.relname = 'app_entity_audit_log'
       and cn.nspname = 'public'
       and c.relname like 'app_entity_audit_log_p%'
  loop
    execute format('alter table public.%I enable row level security', r.partition_name);
    execute format('revoke all on table public.%I from anon, authenticated, public', r.partition_name);
    execute format('grant select on table public.%I to service_role', r.partition_name);

    if not exists (
      select 1
        from pg_policies
       where schemaname = 'public'
         and tablename = r.partition_name
         and policyname = 'service_role_all'
    ) then
      execute format(
        'create policy service_role_all on public.%I for all to service_role using (true) with check (true)',
        r.partition_name
      );
    end if;
  end loop;
end $$;

create or replace function public.ensure_app_entity_audit_log_partitions(p_months_ahead integer default 3)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_months integer := greatest(coalesce(p_months_ahead, 3), 1);
  v_start date := date_trunc('month', now())::date;
  v_from date;
  v_to date;
  v_name text;
begin
  for i in 0..v_months loop
    v_from := (v_start + make_interval(months => i))::date;
    v_to := (v_start + make_interval(months => i + 1))::date;
    v_name := format('app_entity_audit_log_p%s', to_char(v_from, 'YYYYMM'));
    execute format(
      'create table if not exists public.%I partition of public.app_entity_audit_log for values from (%L) to (%L)',
      v_name,
      v_from,
      v_to
    );
    execute format('alter table public.%I enable row level security', v_name);
    execute format('revoke all on table public.%I from anon, authenticated, public', v_name);
    execute format('grant select on table public.%I to service_role', v_name);

    if not exists (
      select 1
        from pg_policies
       where schemaname = 'public'
         and tablename = v_name
         and policyname = 'service_role_all'
    ) then
      execute format(
        'create policy service_role_all on public.%I for all to service_role using (true) with check (true)',
        v_name
      );
    end if;
  end loop;
end;
$function$;

drop policy if exists registration_consents_insert_client_anon on public.registration_consents;
drop policy if exists registration_consents_insert_client_auth on public.registration_consents;

revoke insert on table public.registration_consents from anon;
revoke update, delete on table public.registration_consents from authenticated;

create policy registration_consents_insert_client_auth
on public.registration_consents
for insert
to authenticated
with check (
  user_id = auth.uid()
  and length(trim(email)) between 3 and 320
  and account_type in ('solo', 'company')
  and consent_offer is true
  and consent_privacy_policy is true
  and consent_personal_data is true
  and consent_cookies is true
  and consent_source in ('mobile_app', 'web_app')
);

create index if not exists idx_billing_yookassa_payments_pending_created_at
  on public.billing_yookassa_payments (created_at)
  where status = 'pending';

create index if not exists idx_orders_feed_unassigned_reminder
  on public.orders (company_id, created_by_user_id, feed_entered_at, updated_at, created_at, id)
  where status = 'В ленте' and assigned_to is null;

create index if not exists idx_profiles_company_active_admin_lookup
  on public.profiles (company_id, created_at, updated_at, id)
  where lower(coalesce(role, '')) = 'admin'
    and coalesce(is_admin_blocked, false) = false;

create index if not exists idx_profiles_company_non_admin_license_lookup
  on public.profiles (company_id, license_state, id)
  where lower(coalesce(role, '')) <> 'admin'
    and coalesce(is_admin_blocked, false) = false;

create index if not exists idx_media_cleanup_queue_claim_global
  on public.media_cleanup_queue (status, not_before, id)
  where processed_at is null
    and status in ('pending', 'retrying');

drop index if exists public.orders_assigned_time_idx;
drop index if exists public.idx_notification_events_order_ref_id;
drop index if exists public.idx_media_cleanup_queue_feedback_id;
drop index if exists public.idx_media_cleanup_queue_feedback_attachment_id;

analyze public.registration_consents;
analyze public.registration_email_codes;
analyze public.registration_email_proofs;
analyze public.orders;
analyze public.profiles;
analyze public.media_cleanup_queue;
analyze public.billing_yookassa_payments;
