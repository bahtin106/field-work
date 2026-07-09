-- Internal license maintenance helpers are invoked from trusted RPCs/triggers.
-- Direct authenticated access is unnecessary and can mutate subscription/member
-- license state, so keep it service/internal only.

revoke execute on function public.apply_pending_seat_change_if_due(uuid) from authenticated;
grant execute on function public.apply_pending_seat_change_if_due(uuid) to service_role;

revoke execute on function public.sync_member_license_state(uuid, uuid) from authenticated;
grant execute on function public.sync_member_license_state(uuid, uuid) to service_role;
