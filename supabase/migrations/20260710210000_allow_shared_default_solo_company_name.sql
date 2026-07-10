begin;

drop index if exists public.companies_name_normalized_uq;

create unique index companies_name_normalized_uq
  on public.companies (lower(public.normalize_company_name(name)))
  where lower(public.normalize_company_name(name)) <> U&'\043C\043E\044F \043A\043E\043C\043F\0430\043D\0438\044F';

commit;
