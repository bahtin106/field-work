import { handlePushSendRequest } from '../push-send/index.ts';
import { handleInviteUserRequest } from '../invite-user/index.ts';
import { handleRegisterUserRequest } from '../register-user/index.ts';
import { handleRegisterRequestCode } from '../register-request-code/index.ts';
import { handleRegisterVerifyCode } from '../register-verify-code/index.ts';
import { handleDeleteUserRequest } from '../delete_user/index.ts';
import { handlePushTokenSyncRequest } from '../push-token-sync/index.ts';
import { handleYandexDiskIntegrationRequest } from '../yandex-disk-integration/index.ts';
import { handleYandexDiskMediaRequest } from '../yandex-disk-media/index.ts';
import { handleYandexDiskReconcileRequest } from '../yandex-disk-reconcile/index.ts';
import { handleProfileMediaStorageRequest } from '../profile-media-storage/index.ts';
import { handleOrderMediaStorageRequest } from '../order-media-storage/index.ts';
import { handleFinanceEntryMediaStorageRequest } from '../finance-entry-media-storage/index.ts';
import { handleFinanceEntryYandexMediaRequest } from '../finance-entry-yandex-media/index.ts';
import { handleObjectMediaStorageRequest } from '../object-media-storage/index.ts';
import { handleMediaCleanupRequest } from '../media-cleanup/index.ts';
import { handleBackfillMediaSizesRequest } from '../backfill-media-sizes/index.ts';
import { handleTelegramBotRequest } from '../telegram-bot/index.ts';
import { handleSwitchAccountModeRequest } from '../switch-account-mode/index.ts';
import { handleRequestPasswordReset } from '../request-password-reset/index.ts';
import { handlePublicSupportRequest } from '../public-support-request/index.ts';
import { handleAdminDeleteCompanyRequest } from '../admin-delete-company/index.ts';

function extractFunctionName(req: Request) {
  const url = new URL(req.url);
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  const relayHeader = String(req.headers.get('x-relay-function-name') || '').trim();
  if (relayHeader) return relayHeader;

  if (normalizedPath.startsWith('/functions/v1/')) {
    const rest = normalizedPath.slice('/functions/v1/'.length);
    const [name] = rest.split('/').filter(Boolean);
    return name || '';
  }

  const [name] = normalizedPath.split('/').filter(Boolean);
  return name || '';
}

Deno.serve(async (req) => {
  const fn = extractFunctionName(req);

  if (fn === 'push-send') return handlePushSendRequest(req);
  if (fn === 'invite-user' || fn === 'invite_user') return handleInviteUserRequest(req);
  if (fn === 'register-user' || fn === 'register_user') return handleRegisterUserRequest(req);
  if (fn === 'register-request-code') return handleRegisterRequestCode(req);
  if (fn === 'register-verify-code') return handleRegisterVerifyCode(req);
  if (fn === 'delete-user' || fn === 'delete_user') return handleDeleteUserRequest(req);
  if (fn === 'push-token-sync') return handlePushTokenSyncRequest(req);
  if (fn === 'yandex-disk-integration') return handleYandexDiskIntegrationRequest(req);
  if (fn === 'yandex-disk-media') return handleYandexDiskMediaRequest(req);
  if (fn === 'yandex-disk-reconcile') return handleYandexDiskReconcileRequest(req);
  if (fn === 'profile-media-storage') return handleProfileMediaStorageRequest(req);
  if (fn === 'order-media-storage') return handleOrderMediaStorageRequest(req);
  if (fn === 'finance-entry-media-storage') return handleFinanceEntryMediaStorageRequest(req);
  if (fn === 'finance-entry-yandex-media') return handleFinanceEntryYandexMediaRequest(req);
  if (fn === 'object-media-storage') return handleObjectMediaStorageRequest(req);
  if (fn === 'media-cleanup') return handleMediaCleanupRequest(req);
  if (fn === 'backfill-media-sizes') return handleBackfillMediaSizesRequest(req);
  if (fn === 'telegram-bot') return handleTelegramBotRequest(req);
  if (fn === 'switch-account-mode') return handleSwitchAccountModeRequest(req);
  if (fn === 'request-password-reset') return handleRequestPasswordReset(req);
  if (fn === 'public-support-request') return handlePublicSupportRequest(req);
  if (fn === 'admin-delete-company' || fn === 'admin_delete_company') return handleAdminDeleteCompanyRequest(req);

  return new Response(JSON.stringify({ success: false, message: `Unknown function: ${fn || 'none'}` }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
});
