begin;

create or replace function public.clients_sync_name_and_audit()
returns trigger
language plpgsql
as $$
declare
  v_uid uuid := auth.uid();
  v_full_name text;
begin
  new.first_name := btrim(coalesce(new.first_name, ''));
  new.last_name := btrim(coalesce(new.last_name, ''));
  new.middle_name := nullif(btrim(coalesce(new.middle_name, '')), '');
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.phone := nullif(btrim(coalesce(new.phone, '')), '');
  new.secondary_phone := nullif(btrim(coalesce(new.secondary_phone, '')), '');
  new.additional_phone_1 := nullif(btrim(coalesce(new.additional_phone_1, '')), '');
  new.additional_phone_1_label := nullif(left(btrim(coalesce(new.additional_phone_1_label, '')), 48), '');
  new.additional_phone_2 := nullif(btrim(coalesce(new.additional_phone_2, '')), '');
  new.additional_phone_2_label := nullif(left(btrim(coalesce(new.additional_phone_2_label, '')), 48), '');
  new.additional_phone_3 := nullif(btrim(coalesce(new.additional_phone_3, '')), '');
  new.additional_phone_3_label := nullif(left(btrim(coalesce(new.additional_phone_3_label, '')), 48), '');
  new.contact_pref := nullif(btrim(coalesce(new.contact_pref, '')), '');

  if new.additional_phone_1 is null and new.secondary_phone is not null then
    new.additional_phone_1 := new.secondary_phone;
  end if;
  new.secondary_phone := new.additional_phone_1;

  v_full_name := nullif(
    regexp_replace(
      btrim(concat_ws(' ', new.last_name, new.first_name, coalesce(new.middle_name, ''))),
      '\s+',
      ' ',
      'g'
    ),
    ''
  );
  new.full_name := coalesce(v_full_name, new.full_name, '');

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, v_uid);
    new.updated_by := coalesce(new.updated_by, v_uid);
  end if;

  new.updated_by := coalesce(v_uid, new.updated_by);

  return new;
end
$$;

update public.clients
set additional_phone_1_label = nullif(left(btrim(coalesce(additional_phone_1_label, '')), 48), ''),
    additional_phone_2_label = nullif(left(btrim(coalesce(additional_phone_2_label, '')), 48), ''),
    additional_phone_3_label = nullif(left(btrim(coalesce(additional_phone_3_label, '')), 48), '')
where true;

alter table public.clients
  drop constraint if exists clients_additional_phone_1_label_len_check,
  drop constraint if exists clients_additional_phone_2_label_len_check,
  drop constraint if exists clients_additional_phone_3_label_len_check;

alter table public.clients
  add constraint clients_additional_phone_1_label_len_check
    check (additional_phone_1_label is null or char_length(additional_phone_1_label) <= 48),
  add constraint clients_additional_phone_2_label_len_check
    check (additional_phone_2_label is null or char_length(additional_phone_2_label) <= 48),
  add constraint clients_additional_phone_3_label_len_check
    check (additional_phone_3_label is null or char_length(additional_phone_3_label) <= 48);

commit;

