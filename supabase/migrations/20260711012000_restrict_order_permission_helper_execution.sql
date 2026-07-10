begin;

revoke all on function public.order_role_has_permission(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.order_role_has_permission(uuid, text, text) to service_role;

commit;
