begin;

drop function if exists public.purge_all_trash_items();

notify pgrst, 'reload schema';

commit;
