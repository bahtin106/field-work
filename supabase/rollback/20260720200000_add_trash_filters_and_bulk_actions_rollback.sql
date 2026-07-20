begin;

drop function if exists public.purge_trash_items(uuid[]);
drop function if exists public.restore_trash_items(uuid[]);
drop function if exists public.get_trash_filter_options();
drop function if exists public.list_trash_item_ids_v2(text, jsonb);
drop function if exists public.list_trash_items_v2(text, jsonb, text, integer, integer);
drop function if exists public.trash_item_matches_filters(public.trash_entries, jsonb);
drop function if exists public.trash_entry_client_id(public.trash_entries);
drop function if exists public.trash_entry_object_id(public.trash_entries);
drop function if exists public.trash_entry_order_id(public.trash_entries);

drop index if exists public.trash_entries_company_deleted_by_idx;
drop index if exists public.trash_entries_company_type_deleted_idx;

notify pgrst, 'reload schema';
commit;
