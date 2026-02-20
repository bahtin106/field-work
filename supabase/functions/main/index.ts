import { handlePushSendRequest } from '../push-send/index.ts';
import { handleInviteUserRequest } from '../invite-user/index.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');

  if (path === '/push-send') {
    return handlePushSendRequest(req);
  }
  if (path === '/invite-user') {
    return handleInviteUserRequest(req);
  }

  return new Response('OK', { status: 200 });
});
