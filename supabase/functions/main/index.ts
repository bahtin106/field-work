import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
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
import { handleMediaThumbnailRequest } from '../media-thumbnail/index.ts';
import { handleSwitchAccountModeRequest } from '../switch-account-mode/index.ts';
import { handleRequestPasswordReset } from '../request-password-reset/index.ts';
import { handleChangeEmailRequest } from '../change-email/index.ts';
import { handlePublicSupportRequest } from '../public-support-request/index.ts';
import { handleAdminDeleteCompanyRequest } from '../admin-delete-company/index.ts';
import { handleUpdateUserRequest } from '../update_user/index.ts';
import { handleTelegramBotRequest } from '../telegram-bot/index.ts';
import { handleMaxBotRequest } from '../max-bot/index.ts';
import { handleAccountDeletionRequest } from '../account-deletion/index.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY') || '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// These handlers cross the service-role boundary after authenticating the
// caller. The router performs one shared, fail-closed operational access check
// before any handler can reach privileged storage/auth/database operations.
const ACTIVE_ACCESS_FUNCTIONS = new Set([
  'invite-user',
  'invite_user',
  'delete-user',
  'delete_user',
  'push-token-sync',
  'yandex-disk-integration',
  'yandex-disk-media',
  'yandex-disk-reconcile',
  'profile-media-storage',
  'order-media-storage',
  'finance-entry-media-storage',
  'finance-entry-yandex-media',
  'object-media-storage',
  'backfill-media-sizes',
  'switch-account-mode',
  'change-email',
  'change_email',
  'admin-delete-company',
  'admin_delete_company',
  'update-user',
  'update_user',
]);

const ACTION_GATED_BOT_FUNCTIONS = new Set(['telegram-bot', 'max-bot']);

type AccessState = {
  can_login?: unknown;
  block_code?: unknown;
};

function jsonError(status: number, code: string) {
  return new Response(JSON.stringify({ success: false, message: code, code }), {
    status,
    headers: jsonHeaders,
  });
}

function extractBearer(req: Request) {
  return String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

function firstAccessState(value: unknown): AccessState | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === 'object' ? candidate as AccessState : null;
}

export async function requireActiveFunctionAccess(
  req: Request,
  options: { allowBlockedCleanup?: boolean } = {},
): Promise<Response | null> {
  const jwt = extractBearer(req);
  if (!jwt) return jsonError(401, 'UNAUTHORIZED');
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonError(503, 'ACCESS_CHECK_UNAVAILABLE');
  }

  // Internal jobs already authenticate the service-role secret in their own
  // handlers and do not represent an employee session.
  if (jwt === SUPABASE_SERVICE_ROLE_KEY) return null;

  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData?.user?.id) return jsonError(401, 'UNAUTHORIZED');

  const { data, error } = await caller.rpc('get_my_access_state');
  if (error) {
    console.warn('[main] active access check unavailable', error.message);
    return jsonError(503, 'ACCESS_CHECK_UNAVAILABLE');
  }

  const access = firstAccessState(data);
  if (access?.can_login !== true) {
    if (options.allowBlockedCleanup === true) return null;
    const blockCode = typeof access?.block_code === 'string' && access.block_code
      ? access.block_code
      : 'ACCOUNT_ACCESS_BLOCKED';
    return jsonError(403, blockCode);
  }
  return null;
}

async function extractRequestAction(req: Request) {
  if (req.method !== 'POST') return '';
  const body = await req.clone().json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  const action = (body as { action?: unknown }).action;
  return typeof action === 'string' ? action.trim().toLowerCase() : '';
}

export function extractFunctionName(req: Request) {
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

export async function routeFunctionRequest(req: Request) {
  const fn = extractFunctionName(req);

  if (req.method !== 'OPTIONS') {
    const needsActionInspection = fn === 'push-token-sync' || ACTION_GATED_BOT_FUNCTIONS.has(fn);
    const action = needsActionInspection ? await extractRequestAction(req) : '';
    const requiresActiveAccess = ACTIVE_ACCESS_FUNCTIONS.has(fn)
      || (ACTION_GATED_BOT_FUNCTIONS.has(fn) && action.length > 0);
    const allowBlockedCleanup = fn === 'push-token-sync' && action === 'delete';
    const denied = requiresActiveAccess
      ? await requireActiveFunctionAccess(req, { allowBlockedCleanup })
      : null;
    if (denied) return denied;
  }

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
  if (fn === 'media-thumbnail') return handleMediaThumbnailRequest(req);
  if (fn === 'telegram-bot') return handleTelegramBotRequest(req);
  if (fn === 'max-bot') return handleMaxBotRequest(req);
  if (fn === 'switch-account-mode') return handleSwitchAccountModeRequest(req);
  if (fn === 'request-password-reset') return handleRequestPasswordReset(req);
  if (fn === 'change-email' || fn === 'change_email') return handleChangeEmailRequest(req);
  if (fn === 'public-support-request') return handlePublicSupportRequest(req);
  if (fn === 'admin-delete-company' || fn === 'admin_delete_company') return handleAdminDeleteCompanyRequest(req);
  if (fn === 'update-user' || fn === 'update_user') return handleUpdateUserRequest(req);
  if (fn === 'account-deletion' || fn === 'account_deletion') return handleAccountDeletionRequest(req);

  return jsonError(404, `Unknown function: ${fn || 'none'}`);
}

if (import.meta.main) {
  Deno.serve(routeFunctionRequest);
}
