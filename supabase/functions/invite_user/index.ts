import { handleInviteUserRequest } from '../invite-user/index.ts';

if (import.meta.main) {
  Deno.serve(handleInviteUserRequest);
}

export { handleInviteUserRequest };
