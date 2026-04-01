begin;

-- Quick-access arrow in Studio for push_tokens.user_id.
alter table public.push_tokens
  drop constraint if exists push_tokens_user_id_fkey;

alter table public.push_tokens
  add constraint push_tokens_user_id_fkey
  foreign key (user_id)
  references public.profiles(id)
  on delete cascade
  not valid;

alter table public.push_tokens
  validate constraint push_tokens_user_id_fkey;

commit;
