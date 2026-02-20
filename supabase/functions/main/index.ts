import { handlePushSendRequest } from '../push-send/index.ts';
import { handleInviteUserRequest } from '../invite-user/index.ts';
import { handleYandexDiskIntegrationRequest } from '../yandex-disk-integration/index.ts';
import { handleYandexDiskMediaRequest } from '../yandex-disk-media/index.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');

  if (path === '/push-send') {
    return handlePushSendRequest(req);
  }
  if (path === '/invite-user') {
    return handleInviteUserRequest(req);
  }
  if (path === '/yandex-disk-integration') {
    return handleYandexDiskIntegrationRequest(req);
  }
  if (path === '/yandex-disk-media') {
    return handleYandexDiskMediaRequest(req);
  }

  return new Response('OK', { status: 200 });
});
