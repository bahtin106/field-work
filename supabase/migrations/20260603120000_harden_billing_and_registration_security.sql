-- Defense-in-depth hardening for admin-only billing tables and registration consent metadata.
do $$
declare
  target_table text;
  target_policy text;
  grant_table text;
  target_privilege text;
begin
  foreach target_table in array array[
    'billing_promo_codes',
    'billing_yookassa_payment_errors',
    'billing_yookassa_payments',
    'billing_yookassa_webhook_events'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format('alter table public.%I enable row level security', target_table);
      execute format('grant all on table public.%I to service_role', target_table);

      target_policy := target_table || '_service_role_all';
      if not exists (
        select 1
          from pg_policies
         where schemaname = 'public'
           and tablename = target_table
           and policyname = target_policy
      ) then
        execute format(
          'create policy %I on public.%I for all to service_role using (true) with check (true)',
          target_policy,
          target_table
        );
      end if;
    end if;
  end loop;

  if to_regclass('public.registration_consents') is not null then
    if exists (
      select 1
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'registration_consents'
         and grantee = 'anon'
         and privilege_type = 'SELECT'
    ) then
      execute 'revoke select on table public.registration_consents from anon';
    end if;

    foreach target_privilege in array array['truncate', 'references', 'trigger']
    loop
      if exists (
        select 1
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = 'registration_consents'
           and grantee = 'authenticated'
           and privilege_type = upper(target_privilege)
      ) then
        execute format('revoke %s on table public.registration_consents from authenticated', target_privilege);
      end if;
    end loop;
  end if;

  foreach grant_table in array array[
    'user_legal_acceptances',
    'user_marketing_preferences',
    'media_assets'
  ]
  loop
    if to_regclass(format('public.%I', grant_table)) is not null then
      foreach target_privilege in array array['truncate', 'references', 'trigger']
      loop
        if exists (
          select 1
            from information_schema.role_table_grants
           where table_schema = 'public'
             and table_name = grant_table
             and grantee = 'authenticated'
             and privilege_type = upper(target_privilege)
        ) then
          execute format('revoke %s on table public.%I from authenticated', target_privilege, grant_table);
        end if;
      end loop;
    end if;
  end loop;
end $$;
