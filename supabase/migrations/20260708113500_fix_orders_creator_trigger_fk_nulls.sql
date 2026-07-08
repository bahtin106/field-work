create or replace function public.orders_sync_creator_and_source()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_auth_actor uuid;
  v_actor uuid;
  v_created_by_cleared boolean := false;
begin
  v_auth_actor := coalesce(auth.uid(), current_user_id());

  if tg_op = 'INSERT' then
    v_actor := coalesce(v_auth_actor, new.created_by_user_id, new.assigned_to);
    new.created_by_user_id := coalesce(new.created_by_user_id, v_actor);
    new.creation_source := coalesce(nullif(btrim(coalesce(new.creation_source, '')), ''), 'app');
  else
    v_actor := coalesce(v_auth_actor, new.created_by_user_id);
    v_created_by_cleared := old.created_by_user_id is not null
      and new.created_by_user_id is null
      and v_auth_actor is null;

    if v_created_by_cleared then
      new.created_by_user_id := null;
    else
      new.created_by_user_id := coalesce(new.created_by_user_id, old.created_by_user_id, v_actor);
    end if;

    new.creation_source := coalesce(
      nullif(btrim(coalesce(new.creation_source, '')), ''),
      old.creation_source,
      'app'
    );
  end if;

  return new;
end;
$function$;
