begin;

drop index if exists public.companies_name_normalized_uq;

create index companies_name_normalized_idx
  on public.companies (lower(public.normalize_company_name(name)));

commit;
