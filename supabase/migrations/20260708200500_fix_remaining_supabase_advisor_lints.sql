-- Remaining Supabase advisor cleanup:
-- - make auth.uid() RLS checks initplan-friendly
-- - add missing covering indexes for foreign keys
-- - keep pg_net response cleanup healthy after the one-time manual VACUUM FULL

drop policy if exists "Users can read own legal acceptances" on public.user_legal_acceptances;
create policy "Users can read own legal acceptances"
on public.user_legal_acceptances
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists registration_consents_select_own on public.registration_consents;
create policy registration_consents_select_own
on public.registration_consents
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists registration_consents_insert_client_auth on public.registration_consents;
create policy registration_consents_insert_client_auth
on public.registration_consents
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and length(trim(email)) between 3 and 320
  and account_type in ('solo', 'company')
  and consent_offer is true
  and consent_privacy_policy is true
  and consent_personal_data is true
  and consent_cookies is true
  and consent_source in ('mobile_app', 'web_app')
);

drop policy if exists "Users can read own marketing preferences" on public.user_marketing_preferences;
create policy "Users can read own marketing preferences"
on public.user_marketing_preferences
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own marketing preferences" on public.user_marketing_preferences;
create policy "Users can insert own marketing preferences"
on public.user_marketing_preferences
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own marketing preferences" on public.user_marketing_preferences;
create policy "Users can update own marketing preferences"
on public.user_marketing_preferences
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create index if not exists idx_billing_promo_codes_created_by_fk
  on public.billing_promo_codes (created_by);
create index if not exists idx_billing_yookassa_payments_promo_code_id_fk
  on public.billing_yookassa_payments (promo_code_id);
create index if not exists idx_company_integration_oauth_states_requested_by_fk
  on public.company_integration_oauth_states (requested_by);
create index if not exists idx_company_yandex_disk_connections_created_by_fk
  on public.company_yandex_disk_connections (created_by);
create index if not exists idx_feedback_attachments_created_by_fk
  on public.feedback_attachments (created_by);
create index if not exists idx_feedbacks_read_by_fk
  on public.feedbacks (read_by);
create index if not exists idx_finance_entry_media_external_map_created_by_fk
  on public.finance_entry_media_external_map (created_by);
create index if not exists idx_messenger_conversations_last_client_id_fk
  on public.messenger_conversations (last_client_id);
create index if not exists idx_messenger_conversations_last_object_id_fk
  on public.messenger_conversations (last_object_id);
create index if not exists idx_messenger_conversations_last_order_id_fk
  on public.messenger_conversations (last_order_id);
create index if not exists idx_messenger_integrations_destination_user_id_fk
  on public.messenger_integrations (destination_user_id);
create index if not exists idx_object_media_external_map_created_by_fk
  on public.object_media_external_map (created_by);
create index if not exists idx_profile_media_external_map_created_by_fk
  on public.profile_media_external_map (created_by);
create index if not exists idx_super_admins_created_by_fk
  on public.super_admins (created_by);
create index if not exists idx_user_legal_acceptances_user_id_fk
  on public.user_legal_acceptances (user_id);

alter table net._http_response set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_threshold = 50
);

analyze public.user_legal_acceptances;
analyze public.registration_consents;
analyze public.user_marketing_preferences;
analyze public.billing_promo_codes;
analyze public.billing_yookassa_payments;
analyze public.company_integration_oauth_states;
analyze public.company_yandex_disk_connections;
analyze public.feedback_attachments;
analyze public.feedbacks;
analyze public.finance_entry_media_external_map;
analyze public.messenger_conversations;
analyze public.messenger_integrations;
analyze public.object_media_external_map;
analyze public.profile_media_external_map;
analyze public.super_admins;
analyze net._http_response;
