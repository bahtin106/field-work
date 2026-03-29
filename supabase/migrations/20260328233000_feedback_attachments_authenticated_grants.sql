-- Allow app users to work with support request attachments under RLS policies.

grant select, insert, update, delete on table public.feedback_attachments to authenticated;
grant select, insert, update, delete on table public.feedback_attachments to service_role;
