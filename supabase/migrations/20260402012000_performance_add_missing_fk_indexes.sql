set statement_timeout = '60s';
set lock_timeout = '5s';

create index concurrently if not exists idx_app_entity_audit_log_p202603_client_id_fk on public.app_entity_audit_log_p202603 (client_id);
create index concurrently if not exists idx_app_entity_audit_log_p202603_client_object_id_fk on public.app_entity_audit_log_p202603 (client_object_id);
create index concurrently if not exists idx_app_entity_audit_log_p202603_company_finance_rule_id_fk on public.app_entity_audit_log_p202603 (company_finance_rule_id);
create index concurrently if not exists idx_app_entity_audit_log_p202603_order_finance_entry_id_fk on public.app_entity_audit_log_p202603 (order_finance_entry_id);
create index concurrently if not exists idx_app_entity_audit_log_p202603_order_id_fk on public.app_entity_audit_log_p202603 (order_id);

create index concurrently if not exists idx_notification_events_order_ref_id_fk on public.notification_events (order_ref_id);
create index concurrently if not exists idx_notification_events_recipient_user_id_fk on public.notification_events (recipient_user_id);

create index concurrently if not exists idx_media_cleanup_queue_feedback_attachment_id_fk on public.media_cleanup_queue (feedback_attachment_id);
create index concurrently if not exists idx_media_cleanup_queue_feedback_id_fk on public.media_cleanup_queue (feedback_id);
create index concurrently if not exists idx_media_cleanup_queue_order_id_fk on public.media_cleanup_queue (order_id);

create index concurrently if not exists idx_company_entity_field_settings_entity_type_field_key_fk on public.company_entity_field_settings (entity_type, field_key);
create index concurrently if not exists idx_app_role_permissions_updated_by_fk on public.app_role_permissions (updated_by);

create index concurrently if not exists idx_order_finance_entries_created_by_fk on public.order_finance_entries (created_by);
create index concurrently if not exists idx_order_finance_entries_recipient_user_id_fk on public.order_finance_entries (recipient_user_id);
create index concurrently if not exists idx_order_finance_entries_rule_id_fk on public.order_finance_entries (rule_id);
create index concurrently if not exists idx_order_finance_entries_updated_by_fk on public.order_finance_entries (updated_by);

create index concurrently if not exists idx_company_tags_created_by_fk on public.company_tags (created_by);
create index concurrently if not exists idx_company_tags_updated_by_fk on public.company_tags (updated_by);

create index concurrently if not exists idx_order_media_external_map_created_by_fk on public.order_media_external_map (created_by);

create index concurrently if not exists idx_client_objects_created_by_fk on public.client_objects (created_by);
create index concurrently if not exists idx_client_objects_updated_by_fk on public.client_objects (updated_by);

create index concurrently if not exists idx_clients_created_by_fk on public.clients (created_by);
create index concurrently if not exists idx_clients_updated_by_fk on public.clients (updated_by);

create index concurrently if not exists idx_object_tag_links_created_by_fk on public.object_tag_links (created_by);
create index concurrently if not exists idx_object_tag_links_tag_id_fk on public.object_tag_links (tag_id);

create index concurrently if not exists idx_company_messenger_field_settings_provider_field_key_fk on public.company_messenger_field_settings (provider, field_key);

create index concurrently if not exists idx_orders_assigned_to_fk on public.orders (assigned_to);
create index concurrently if not exists idx_orders_client_id_fk on public.orders (client_id);
create index concurrently if not exists idx_orders_company_id_fk on public.orders (company_id);
create index concurrently if not exists idx_orders_object_id_fk on public.orders (object_id);
create index concurrently if not exists idx_orders_work_type_id_fk on public.orders (work_type_id);

create index concurrently if not exists idx_subscription_email_queue_recipient_user_id_fk on public.subscription_email_queue (recipient_user_id);

create index concurrently if not exists idx_client_tag_links_created_by_fk on public.client_tag_links (created_by);
create index concurrently if not exists idx_client_tag_links_tag_id_fk on public.client_tag_links (tag_id);
