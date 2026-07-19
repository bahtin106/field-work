begin;

-- Password reset requests are written only by the service-role edge function.
-- The table grant alone is insufficient for its identity-backed sequence.
grant usage, select
on sequence public.password_reset_requests_id_seq
to service_role;

commit;
