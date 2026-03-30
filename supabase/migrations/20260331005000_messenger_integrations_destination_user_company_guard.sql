begin;

create or replace function public.messenger_integrations_guard_destination_user_company()
returns trigger
language plpgsql
as $$
declare
  v_profile_company_id uuid;
begin
  if new.destination_user_id is null then
    return new;
  end if;

  select p.company_id
    into v_profile_company_id
  from public.profiles p
  where p.id = new.destination_user_id;

  if v_profile_company_id is null then
    raise exception using
      errcode = '23503',
      message = 'destination_user_id must reference an existing profile';
  end if;

  if v_profile_company_id <> new.company_id then
    raise exception using
      errcode = '23514',
      message = 'destination_user_id must belong to the same company as messenger integration';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_messenger_integrations_guard_destination_user_company on public.messenger_integrations;
create trigger trg_messenger_integrations_guard_destination_user_company
before insert or update on public.messenger_integrations
for each row
execute function public.messenger_integrations_guard_destination_user_company();

commit;
