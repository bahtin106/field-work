import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleAdminDeleteCompanyRequest } from '../admin-delete-company/index.ts';
import { handleDeleteUserRequest } from '../delete_user/index.ts';
import { deleteExternalMediaObjects, type ExternalMediaCleanupRow } from '../media-cleanup/index.ts';

const PURPOSE = 'account_deletion';
const CODE_PATTERN = /^\d{6}$/;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
};

type ClaimedDeletion = {
  request_id: string;
  user_id: string;
  company_id?: string | null;
  requested_email?: string | null;
  processing_attempts?: number | null;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeEmail(value: unknown) {
  return text(value).toLowerCase();
}

function getBearer(req: Request) {
  return text(req.headers.get('authorization')).replace(/^Bearer\s+/i, '').trim();
}

function maskEmail(value: string) {
  const [local, domain] = normalizeEmail(value).split('@');
  if (!local || !domain) return '';
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(2, Math.min(8, local.length - visible.length)))}@${domain}`;
}

function getEnvironment() {
  const url = text(Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL'));
  const anonKey = text(Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY'));
  const serviceKey = text(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY'));
  const emailUrl = text(Deno.env.get('EMAIL_SERVICE_URL') || Deno.env.get('EXPO_PUBLIC_EMAIL_SERVICE_URL')).replace(/\/+$/, '');
  const emailToken = text(Deno.env.get('EMAIL_SERVER_API_TOKEN'));
  if (!url || !anonKey || !serviceKey || !emailUrl || !emailToken) throw new Error('SERVER_MISCONFIGURED');
  return { url, anonKey, serviceKey, emailUrl, emailToken };
}

function adminClient(env: ReturnType<typeof getEnvironment>) {
  return createClient(env.url, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application': 'edge-account-deletion' } },
  });
}

function callerClient(env: ReturnType<typeof getEnvironment>, bearer: string) {
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${bearer}`, 'x-application': 'edge-account-deletion' } },
  });
}

async function emailRequest(
  env: ReturnType<typeof getEnvironment>,
  path: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${env.emailUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Email-Server-Token': env.emailToken },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) {
    const error = new Error(text(payload?.code) || 'EMAIL_SERVICE_FAILED') as Error & { status?: number; payload?: any };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function authenticatedActor(req: Request, env: ReturnType<typeof getEnvironment>) {
  const bearer = getBearer(req);
  if (!bearer || bearer === env.serviceKey) throw new Error('UNAUTHORIZED');
  const admin = adminClient(env);
  const { data, error } = await admin.auth.getUser(bearer);
  const user = data?.user;
  if (error || !user?.id) throw new Error('UNAUTHORIZED');
  const email = normalizeEmail(user.email);
  if (!email) throw new Error('ACCOUNT_EMAIL_REQUIRED');
  return { bearer, userId: String(user.id), email };
}

async function verifyAndConsumeCode(
  env: ReturnType<typeof getEnvironment>,
  email: string,
  code: string,
) {
  const verified = await emailRequest(env, '/registration/verify-code', { email, code, purpose: PURPOSE });
  const proof = text(verified?.registration_token);
  if (!proof) throw new Error('CODE_VERIFICATION_FAILED');
  await emailRequest(env, '/registration/consume-token', {
    email,
    purpose: PURPOSE,
    registration_token: proof,
  });
}

async function readJsonResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok && payload?.ok !== false && payload?.success !== false, status: response.status, payload };
}

function internalRequest(body: Record<string, unknown>) {
  return new Request('http://internal/account-deletion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function listExternalRows(
  admin: any,
  table: string,
  applyFilter: (query: any) => any,
) {
  const rows: ExternalMediaCleanupRow[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    let query: any = admin
      .from(table)
      .select('provider,external_path,company_id')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    query = applyFilter(query);
    const { data, error } = await query;
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function cleanupCompanyExternalMedia(admin: any, companyId: string) {
  const tables = [
    'profile_media_external_map',
    'order_media_external_map',
    'object_media_external_map',
    'finance_entry_media_external_map',
  ];
  const pages = await Promise.all(
    tables.map((table) => listExternalRows(admin, table, (query) => query.eq('company_id', companyId))),
  );
  return deleteExternalMediaObjects(admin, pages.flat());
}

async function cleanupUserExternalMedia(
  admin: any,
  companyId: string | null,
  userId: string,
) {
  if (!companyId) return { deleted: 0 };
  const rows = await listExternalRows(admin, 'profile_media_external_map', (query) =>
    query.eq('company_id', companyId).eq('entity_id', userId),
  );
  return deleteExternalMediaObjects(admin, rows);
}

async function listCompanyUserIds(admin: any, companyId: string, ownerId: string) {
  const { data, error } = await admin
    .from('profiles')
    .select('id')
    .eq('company_id', companyId);
  if (error) throw error;
  return [...new Set([
    ownerId,
    ...(Array.isArray(data) ? data.map((row) => text(row?.id)) : []),
  ].filter(Boolean))];
}

async function cleanupSupabaseStorage(admin: any, userIds: string[]) {
  const normalizedIds = [...new Set(userIds.map(text).filter(Boolean))];
  if (!normalizedIds.length) return { deleted: 0 };
  const { data, error } = await admin.rpc('list_account_deletion_storage_objects', {
    p_user_ids: normalizedIds,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const byBucket = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = text(row?.bucket_id);
    const name = text(row?.object_name);
    if (!bucket || !name) continue;
    byBucket.set(bucket, [...(byBucket.get(bucket) || []), name]);
  }
  for (const [bucket, names] of byBucket) {
    for (let index = 0; index < names.length; index += 100) {
      const { error: removeError } = await admin.storage.from(bucket).remove(names.slice(index, index + 100));
      if (removeError) throw removeError;
    }
  }
  const { data: leftovers, error: verifyError } = await admin.rpc('list_account_deletion_storage_objects', {
    p_user_ids: normalizedIds,
  });
  if (verifyError) throw verifyError;
  if (Array.isArray(leftovers) && leftovers.length > 0) {
    throw new Error('SUPABASE_STORAGE_CLEANUP_INCOMPLETE');
  }
  return { deleted: rows.length };
}

function chooseSuccessor(context: any) {
  const candidates = Array.isArray(context?.candidates) ? [...context.candidates] : [];
  const rank: Record<string, number> = { admin: 0, dispatcher: 1, worker: 2 };
  candidates.sort((left, right) => {
    const roleDiff = (rank[text(left?.role).toLowerCase()] ?? 9) - (rank[text(right?.role).toLowerCase()] ?? 9);
    if (roleDiff) return roleDiff;
    return text(left?.id).localeCompare(text(right?.id));
  });
  return text(candidates[0]?.id) || null;
}

async function completeRequest(admin: any, requestId: string) {
  const { error } = await admin.rpc('transition_account_deletion_request', {
    p_request_id: requestId,
    p_expected_status: 'processing',
    p_next_status: 'completed',
    p_confirmation_sent_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function processClaimedDeletion(
  env: ReturnType<typeof getEnvironment>,
  claimed: ClaimedDeletion,
) {
  const requestId = text(claimed.request_id);
  const userId = text(claimed.user_id);
  const companyId = text(claimed.company_id) || null;
  if (!requestId || !userId) throw new Error('INVALID_DELETION_JOB');
  const admin = adminClient(env);
  const trusted = { requestId, userId };

  const inspectResponse = await handleDeleteUserRequest(
    internalRequest({ action: 'inspect', user_id: userId }),
    trusted,
  );
  const inspected = await readJsonResponse(inspectResponse);

  if (!inspected.ok && text(inspected.payload?.code) === 'USER_NOT_FOUND') {
    await cleanupSupabaseStorage(admin, [userId]);
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch {}
    try {
      await admin.rpc('cleanup_auth_identity_orphans', {
        p_email: normalizeEmail(claimed.requested_email) || null,
        p_user_id: userId,
      });
    } catch {}
    await completeRequest(admin, requestId);
    return { request_id: requestId, deleted_user_id: userId, recovered_partial_delete: true };
  }
  if (!inspected.ok) throw new Error(text(inspected.payload?.code || inspected.payload?.message) || 'DELETE_INSPECTION_FAILED');

  const context = inspected.payload;
  const resolvedCompanyId = text(context?.company?.id || context?.user?.company_id || companyId) || null;
  let companyWorkMode = '';
  let otherCompanyMembers = 0;
  if (resolvedCompanyId) {
    const { data: company, error } = await admin
      .from('companies')
      .select('id,work_mode')
      .eq('id', resolvedCompanyId)
      .maybeSingle();
    if (error) throw error;
    companyWorkMode = text(company?.work_mode).toLowerCase();
    const { count, error: memberCountError } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', resolvedCompanyId)
      .neq('id', userId);
    if (memberCountError) throw memberCountError;
    otherCompanyMembers = Number(count || 0);
  }

  const shouldDeleteCompany = resolvedCompanyId && (
    companyWorkMode === 'solo'
    || (context?.company_delete_required === true && otherCompanyMembers === 0)
  );
  if (context?.company_delete_required === true && !shouldDeleteCompany) {
    throw new Error('ACCOUNT_DELETION_SUCCESSOR_UNAVAILABLE');
  }

  if (resolvedCompanyId && shouldDeleteCompany) {
    const companyUserIds = await listCompanyUserIds(admin, resolvedCompanyId, userId);
    await cleanupSupabaseStorage(admin, companyUserIds);
    await cleanupCompanyExternalMedia(admin, resolvedCompanyId);
    const companyResponse = await handleAdminDeleteCompanyRequest(
      internalRequest({ company_id: resolvedCompanyId, confirm: true, force_active_requests: true }),
      { requestId, userId, companyId: resolvedCompanyId },
    );
    const companyResult = await readJsonResponse(companyResponse);
    if (!companyResult.ok) {
      throw new Error(text(companyResult.payload?.message) || 'COMPANY_DELETE_FAILED');
    }
    await completeRequest(admin, requestId);
    return { request_id: requestId, deleted_user_id: userId, deleted_company_id: resolvedCompanyId };
  }

  await cleanupSupabaseStorage(admin, [userId]);
  await cleanupUserExternalMedia(admin, resolvedCompanyId, userId);
  const successorId = context?.requires_successor ? chooseSuccessor(context) : null;
  if (context?.requires_successor && !successorId) throw new Error('ACCOUNT_DELETION_SUCCESSOR_UNAVAILABLE');
  const deleteResponse = await handleDeleteUserRequest(
    internalRequest({ action: 'delete', user_id: userId, reassign_to: successorId }),
    trusted,
  );
  const deleted = await readJsonResponse(deleteResponse);
  if (!deleted.ok) throw new Error(text(deleted.payload?.code || deleted.payload?.message) || 'USER_DELETE_FAILED');
  await completeRequest(admin, requestId);
  return { request_id: requestId, deleted_user_id: userId, successor_id: successorId };
}

async function processPending(env: ReturnType<typeof getEnvironment>, limit = 5) {
  const admin = adminClient(env);
  const worker = `account-deletion@${text(Deno.env.get('HOSTNAME')) || 'edge'}`;
  const { data, error } = await admin.rpc('claim_verified_account_deletions', {
    p_limit: Math.max(1, Math.min(25, Number(limit) || 5)),
    p_worker: worker,
    p_lock_seconds: 600,
  });
  if (error) throw error;
  const claimed = Array.isArray(data) ? data as ClaimedDeletion[] : [];
  const results: Record<string, unknown>[] = [];
  for (const row of claimed) {
    try {
      results.push({ ok: true, ...(await processClaimedDeletion(env, row)) });
    } catch (error) {
      const message = text((error as Error)?.message || error) || 'ACCOUNT_DELETION_PROCESSING_FAILED';
      console.error('[account-deletion] processing failed', { requestId: row.request_id, message });
      try {
        await admin.rpc('release_verified_account_deletion', {
          p_request_id: row.request_id,
          p_error: message,
        });
      } catch {}
      results.push({ ok: false, request_id: row.request_id, error: message });
    }
  }
  return { claimed: claimed.length, results };
}

function publicError(error: unknown) {
  const code = text((error as Error)?.message || error || 'INTERNAL_ERROR').toUpperCase();
  const status =
    code === 'UNAUTHORIZED' ? 401
      : code === 'RATE_LIMITED' || code === 'TOO_MANY_ATTEMPTS' ? 429
        : ['INVALID_CODE', 'CODE_EXPIRED', 'ACCOUNT_EMAIL_REQUIRED'].includes(code) ? 400
          : code === 'ALREADY_PROCESSING' ? 409
            : 503;
  return json({ ok: false, code }, status);
}

export async function handleAccountDeletionRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const env = getEnvironment();
    const body = await req.clone().json().catch(() => ({}));
    const action = text(body?.action).toLowerCase();

    if (action === 'process_pending') {
      const bearer = getBearer(req);
      if (!bearer || bearer !== env.serviceKey) throw new Error('UNAUTHORIZED');
      return json({ ok: true, ...(await processPending(env, Number(body?.limit) || 5)) });
    }

    const actor = await authenticatedActor(req, env);
    if (action === 'request_code') {
      const admin = adminClient(env);
      const { data: active } = await admin
        .from('account_deletion_requests')
        .select('id,status,email_verified_at')
        .eq('user_id', actor.userId)
        .eq('status', 'processing')
        .maybeSingle();
      if (active?.email_verified_at) throw new Error('ALREADY_PROCESSING');
      const caller = callerClient(env, actor.bearer);
      const { data: requestRows, error: requestError } = await caller.rpc('request_account_deletion');
      if (requestError) throw requestError;
      const deletionRequest = Array.isArray(requestRows) ? requestRows[0] : requestRows;
      const requestId = text(deletionRequest?.request_id);
      if (!requestId) throw new Error('ACCOUNT_DELETION_REQUEST_FAILED');
      const sent = await emailRequest(env, '/registration/send-code', {
        email: actor.email,
        purpose: PURPOSE,
      });
      return json({
        ok: true,
        email_masked: maskEmail(actor.email),
        cooldown_seconds: Number(sent?.cooldown_seconds || 60),
        expires_in_seconds: Number(sent?.expires_in_seconds || 600),
        request_id: requestId,
        status: 'pending',
      });
    }

    if (action !== 'confirm') throw new Error('INVALID_ACTION');
    const code = text(body?.code);
    if (!CODE_PATTERN.test(code)) throw new Error('INVALID_CODE');
    await verifyAndConsumeCode(env, actor.email, code);

    const caller = callerClient(env, actor.bearer);
    const { data: requestRows, error: requestError } = await caller.rpc('request_account_deletion');
    if (requestError) throw requestError;
    const deletionRequest = Array.isArray(requestRows) ? requestRows[0] : requestRows;
    const requestId = text(deletionRequest?.request_id);
    if (!requestId) throw new Error('ACCOUNT_DELETION_REQUEST_FAILED');

    const admin = adminClient(env);
    const { error: verifiedError } = await admin.rpc('mark_account_deletion_email_verified', {
      p_request_id: requestId,
      p_user_id: actor.userId,
    });
    if (verifiedError) throw verifiedError;

    const edgeRuntime = (globalThis as typeof globalThis & {
      EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
    }).EdgeRuntime;
    if (typeof edgeRuntime?.waitUntil === 'function') {
      edgeRuntime.waitUntil(processPending(env, 5).catch((error) => {
        console.error('[account-deletion] background trigger failed', text((error as Error)?.message || error));
      }));
    }

    return json({ ok: true, request_id: requestId, status: 'processing' }, 202);
  } catch (error) {
    console.error('[account-deletion]', text((error as Error)?.message || error));
    return publicError(error);
  }
}

if (import.meta.main) {
  Deno.serve(handleAccountDeletionRequest);
}
