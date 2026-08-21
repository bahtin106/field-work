begin;

do $$
begin
  if to_regclass('public.account_deletion_requests') is not null then
    if exists (select 1 from public.account_deletion_requests) then
      raise exception
        'ACCOUNT_DELETION_ROLLBACK_REFUSED: export and transfer every request before removing the authoritative queue';
    end if;
  end if;
end;
$$;

drop function if exists public.transition_account_deletion_request(uuid, text, text, timestamptz);
drop function if exists public.request_account_deletion();
drop table if exists public.account_deletion_requests;
drop function if exists public.account_deletion_requests_preserve_active_delete();
drop function if exists public.account_deletion_requests_set_updated_at();

commit;
