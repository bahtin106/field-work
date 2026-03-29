-- Drop deprecated support request fields that are not used in app logic.

alter table if exists public.feedbacks
  drop column if exists email,
  drop column if exists phone;
