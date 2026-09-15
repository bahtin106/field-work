begin;

drop function if exists public.respond_to_company_invitation(uuid, text, boolean);
drop function if exists public.get_my_company_invitations();
drop function if exists public.create_existing_account_company_invitation(
  uuid, uuid, uuid, text, uuid, text
);

do $$
begin
  if to_regclass('public.company_invitations') is not null then
    execute 'drop trigger if exists company_invitations_set_updated_at on public.company_invitations';
  end if;
end;
$$;

drop function if exists public.company_invitations_set_updated_at();
drop table if exists public.company_invitations;

commit;
