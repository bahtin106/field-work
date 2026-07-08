create or replace function public.order_finance_entries_sync_audit_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid;
  v_created_by_cleared boolean := false;
  v_updated_by_cleared boolean := false;
begin
  if tg_op = 'INSERT' then
    v_actor := coalesce(auth.uid(), new.updated_by, new.created_by);

    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, new.created_at, now());
    new.created_by := coalesce(new.created_by, v_actor);
    new.updated_by := coalesce(new.updated_by, new.created_by, v_actor);
  else
    v_actor := coalesce(auth.uid(), new.updated_by, new.created_by);
    v_created_by_cleared := old.created_by is not null and new.created_by is null and auth.uid() is null;
    v_updated_by_cleared := old.updated_by is not null and new.updated_by is null and auth.uid() is null;

    new.updated_at := now();
    if v_updated_by_cleared then
      new.updated_by := null;
    else
      new.updated_by := coalesce(v_actor, old.updated_by, old.created_by, new.updated_by);
    end if;

    new.created_at := coalesce(new.created_at, old.created_at, now());
    if v_created_by_cleared then
      new.created_by := null;
    else
      new.created_by := coalesce(new.created_by, old.created_by, new.updated_by);
    end if;
  end if;

  if lower(coalesce(new.calc_mode, 'fixed')) = 'fixed' then
    new.input_percent := 0;
  else
    new.input_amount := 0;
  end if;

  return new;
end;
$function$;
