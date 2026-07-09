alter table public.registration_email_codes
  drop constraint if exists registration_email_codes_purpose_check;

alter table public.registration_email_codes
  add constraint registration_email_codes_purpose_check
  check (purpose = any (array[
    'register'::text,
    'recovery'::text,
    'email_change_old'::text,
    'email_change_new'::text
  ]));
