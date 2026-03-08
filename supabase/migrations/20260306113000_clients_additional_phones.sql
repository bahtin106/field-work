begin;

alter table public.clients
  add column if not exists additional_phone_1 text,
  add column if not exists additional_phone_1_label text,
  add column if not exists additional_phone_2 text,
  add column if not exists additional_phone_2_label text,
  add column if not exists additional_phone_3 text,
  add column if not exists additional_phone_3_label text;

update public.clients
set additional_phone_1 = nullif(trim(coalesce(secondary_phone, '')), '')
where additional_phone_1 is null
  and nullif(trim(coalesce(secondary_phone, '')), '') is not null;

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
  new.additional_phone_1_label := nullif(btrim(coalesce(new.additional_phone_1_label, '')), '');
  new.additional_phone_2 := nullif(btrim(coalesce(new.additional_phone_2, '')), '');
  new.additional_phone_2_label := nullif(btrim(coalesce(new.additional_phone_2_label, '')), '');
  new.additional_phone_3 := nullif(btrim(coalesce(new.additional_phone_3, '')), '');
  new.additional_phone_3_label := nullif(btrim(coalesce(new.additional_phone_3_label, '')), '');
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
set additional_phone_1 = nullif(trim(coalesce(additional_phone_1, '')), ''),
    additional_phone_1_label = nullif(trim(coalesce(additional_phone_1_label, '')), ''),
    additional_phone_2 = nullif(trim(coalesce(additional_phone_2, '')), ''),
    additional_phone_2_label = nullif(trim(coalesce(additional_phone_2_label, '')), ''),
    additional_phone_3 = nullif(trim(coalesce(additional_phone_3, '')), ''),
    additional_phone_3_label = nullif(trim(coalesce(additional_phone_3_label, '')), ''),
    secondary_phone = nullif(trim(coalesce(additional_phone_1, secondary_phone, '')), '')
where true;

create index if not exists clients_company_additional_phone_1_idx
  on public.clients(company_id, additional_phone_1)
  where additional_phone_1 is not null;
create index if not exists clients_company_additional_phone_2_idx
  on public.clients(company_id, additional_phone_2)
  where additional_phone_2 is not null;
create index if not exists clients_company_additional_phone_3_idx
  on public.clients(company_id, additional_phone_3)
  where additional_phone_3 is not null;

comment on column public.clients.additional_phone_1 is
  'Additional client phone slot #1. Mirrors legacy secondary_phone for backward compatibility.';
comment on column public.clients.additional_phone_1_label is
  'Optional label for additional client phone slot #1.';
comment on column public.clients.additional_phone_2 is
  'Additional client phone slot #2.';
comment on column public.clients.additional_phone_2_label is
  'Optional label for additional client phone slot #2.';
comment on column public.clients.additional_phone_3 is
  'Additional client phone slot #3.';
comment on column public.clients.additional_phone_3_label is
  'Optional label for additional client phone slot #3.';

commit;
