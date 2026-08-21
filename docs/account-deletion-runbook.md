# Account deletion production runbook

This workflow implements an authenticated whole-account deletion request. It is not a generic support request and must be operated as a privacy queue.

## Service-level objective

- Process every request within 30 calendar days or the shorter period required by applicable law.
- Delete the account record and associated personal data that is not legally required to be retained.
- Send a completion confirmation to the immutable `requested_email` snapshot.
- Record only the minimum legally required retention reason; never copy credentials, tokens, or unrelated customer data into notes.

## Intake and monitoring

The mobile app calls `request_account_deletion()` as the authenticated user. The RPC:

- creates one active row per user in `account_deletion_requests`;
- is idempotent for repeated taps/retries;
- creates a linked internal `feedbacks` item so the existing super-admin notification pipeline alerts the operations team.

The dedicated table is authoritative. Monitor `pending` and `processing` rows at least daily. Only the backend service role may change status; ordinary tenant administrators cannot read or mutate the queue.

Direct table mutation is intentionally unavailable to the service role. Active `pending`/`processing` rows also have a database-level `BEFORE DELETE` guard: an accidental generic cleanup receives `DELETE 0` while the authoritative row remains. Lifecycle changes must use `transition_account_deletion_request(...)`; do not use `TRUNCATE` or temporarily broaden table grants.

## Processing procedure

1. Atomically claim a `pending` row by changing it to `processing` and setting `updated_at = now()` with the service role.
2. Verify the target by `user_id`; never process a user identifier copied from free-form feedback text.
3. Inspect ownership and dependencies using the existing deletion inspection endpoint.
4. For an organisation account, transfer company administration and reassign active work before running the existing user deletion workflow.
5. For a solo owner whose company must be removed, use the existing company-deletion workflow and its backups/cleanup checks. The deployed `admin-delete-company` function must exclude `account_deletion_requests` from both generic company- and user-scoped cleanup loops; the queue row then survives with its `user_id` and `company_id` set to `NULL` by the foreign keys.
6. Verify removal or anonymisation of the auth identity, profile, push tokens, media, user-created content and processor-side copies. Preserve only records required by law and document the retention category outside user-visible free text.
7. Send a completion confirmation to `requested_email` from the approved support mailbox and record its provider delivery timestamp.
8. Only after the profile foreign key has been cleared, call `transition_account_deletion_request(request_id, 'processing', 'completed', confirmation_sent_at)` with the service role. The RPC rejects completion while `user_id` still points to a live profile, then atomically records completion, clears the queue's email/user/company linkage, detaches the linked feedback from the deleted user/company, clears its contact/name snapshots, and closes it. It fails and rolls the transaction back if any linked feedback PII remains after database triggers run. Never mark or delete the feedback independently while its authoritative request is still active.

If identity or ownership cannot be verified, keep the request in `processing` and contact the already-associated email. Do not ask the user to create a second support request. Use `rejected` only for a documented legal/security reason and communicate it to the user.

## Release verification

Before every App Store submission:

- submit a request from a disposable authenticated account;
- confirm exactly one active queue row and one linked internal alert are created;
- process the disposable account through the appropriate owner/employee path;
- confirm the user can no longer authenticate and scoped data is deleted/anonymised;
- confirm completion email delivery;
- confirm the completed queue row has `requested_email`, `user_id` and `company_id` all `NULL`; if `feedback_id` remains set, confirm the linked feedback has `user_id`, `company_id`, `contact` and `full_name` all `NULL`. A solo-company cleanup may delete the feedback first and set `feedback_id` to `NULL` while preserving the authoritative queue row;
- retain the test evidence and timestamps with the release record.

Migration rollback is available at `supabase/rollback/20260821220000_add_account_deletion_requests_rollback.sql`. It refuses to run while any request history exists. Export and transfer every row into an equivalent controlled queue, then explicitly clear the old queue before rollback.
