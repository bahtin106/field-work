begin;

drop function if exists public.cancel_my_account_deletion_request(uuid);
drop function if exists public.list_account_deletion_storage_objects(uuid[]);
drop function if exists public.release_verified_account_deletion(uuid, text);
drop function if exists public.claim_verified_account_deletions(integer, text, integer);
drop function if exists public.mark_account_deletion_email_verified(uuid, uuid);

drop index if exists public.account_deletion_requests_processing_queue_idx;

drop trigger if exists account_deletion_requests_preserve_identity
  on public.account_deletion_requests;
drop function if exists public.account_deletion_requests_preserve_identity();

alter table public.account_deletion_requests
  drop constraint if exists account_deletion_requests_processing_attempts_check,
  drop column if exists last_processing_error,
  drop column if exists processing_worker,
  drop column if exists processing_locked_at,
  drop column if exists next_processing_at,
  drop column if exists processing_attempts,
  drop column if exists email_verified_at,
  drop column if exists requested_company_id,
  drop column if exists requested_user_id;

alter table public.registration_email_codes
  drop constraint if exists registration_email_codes_purpose_check;
alter table public.registration_email_codes
  add constraint registration_email_codes_purpose_check
  check (purpose in ('register', 'recovery', 'email_change_old', 'email_change_new'));

alter table public.registration_email_proofs
  drop constraint if exists registration_email_proofs_purpose_check;
alter table public.registration_email_proofs
  add constraint registration_email_proofs_purpose_check
  check (purpose in ('register', 'recovery'));

commit;
