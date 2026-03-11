import { handlePushSendRequest } from '../push-send/index.ts';
import { handleInviteUserRequest } from '../invite-user/index.ts';
import { handleDeleteUserRequest } from '../delete_user/index.ts';
import { handlePushTokenSyncRequest } from '../push-token-sync/index.ts';
import { handleYandexDiskIntegrationRequest } from '../yandex-disk-integration/index.ts';
import { handleYandexDiskMediaRequest } from '../yandex-disk-media/index.ts';
import { handleYandexDiskReconcileRequest } from '../yandex-disk-reconcile/index.ts';
import { handleProfileMediaStorageRequest } from '../profile-media-storage/index.ts';
import { handleOrderMediaStorageRequest } from '../order-media-storage/index.ts';
import { handleMediaCleanupRequest } from '../media-cleanup/index.ts';
import { handleTelegramBotRequest } from '../telegram-bot/index.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');

  if (path === '/push-send') {
    return handlePushSendRequest(req);
  }
  if (path === '/invite-user') {
    return handleInviteUserRequest(req);
  }
  if (path === '/delete_user' || path === '/delete-user') {
    return handleDeleteUserRequest(req);
  }
  if (path === '/push-token-sync') {
    return handlePushTokenSyncRequest(req);
  }
  if (path === '/yandex-disk-integration') {
    return handleYandexDiskIntegrationRequest(req);
  }
  if (path === '/yandex-disk-media') {
    return handleYandexDiskMediaRequest(req);
  }
  if (path === '/yandex-disk-reconcile') {
    return handleYandexDiskReconcileRequest(req);
  }
  if (path === '/profile-media-storage') {
    return handleProfileMediaStorageRequest(req);
  }
  if (path === '/order-media-storage') {
    return handleOrderMediaStorageRequest(req);
  }
  if (path === '/media-cleanup') {
    return handleMediaCleanupRequest(req);
  }
  if (path === '/telegram-bot') {
    return handleTelegramBotRequest(req);
  }

  return new Response('OK', { status: 200 });
});
