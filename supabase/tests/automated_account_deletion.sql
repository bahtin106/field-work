begin;

do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_request_id uuid;
  v_claim record;
begin
  insert into public.account_deletion_requests (
    requested_user_id,
    requested_email,
    status
  )
  values (
    v_user_id,
    'account-deletion-test@example.invalid',
    'pending'
  )
  returning id into v_request_id;

  perform public.mark_account_deletion_email_verified(v_request_id, v_user_id);

  select *
  into v_claim
  from public.claim_verified_account_deletions(1, 'sql-test', 300)
  where request_id = v_request_id;

  if v_claim.request_id is null
     or v_claim.user_id is distinct from v_user_id
     or v_claim.processing_attempts <> 1 then
    raise exception 'verified deletion request was not claimed correctly';
  end if;

  perform public.release_verified_account_deletion(v_request_id, 'intentional test retry');

  if not exists (
    select 1
    from public.account_deletion_requests r
    where r.id = v_request_id
      and r.status = 'processing'
      and r.email_verified_at is not null
      and r.processing_locked_at is null
      and r.processing_worker is null
      and r.processing_attempts = 1
      and r.next_processing_at > now()
      and r.last_processing_error = 'intentional test retry'
  ) then
    raise exception 'failed deletion request was not released for retry correctly';
  end if;

  perform public.transition_account_deletion_request(
    v_request_id,
    'processing',
    'completed',
    now()
  );

  if not exists (
    select 1
    from public.account_deletion_requests r
    where r.id = v_request_id
      and r.status = 'completed'
      and r.user_id is null
      and r.company_id is null
      and r.requested_user_id is null
      and r.requested_company_id is null
      and r.requested_email is null
  ) then
    raise exception 'completed deletion request retained account identifiers';
  end if;
end;
$$;

rollback;
