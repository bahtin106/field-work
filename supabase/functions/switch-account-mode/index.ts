import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY') || '';

const ACCOUNT_TYPES = new Set(['solo', 'company']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function bool(value: unknown) {
  if (typeof value === 'boolean') return value;
  const normalized = text(value).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function fail(message: string, code: string, status = 400, details: Record<string, unknown> | null = null) {
  return json({ success: false, message, code, details }, status);
}

function opFail(message: string, code: string, details: Record<string, unknown> | null = null) {
  return { __operation_failed: true, message, code, details };
}

function isRpcSignatureMismatch(error: unknown) {
  const payload = (error || {}) as { code?: string; message?: string; details?: string; hint?: string };
  const textValue = `${payload.message || ''} ${payload.details || ''} ${payload.hint || ''}`.toLowerCase();
  return String(payload.code || '') === 'PGRST202' || (textValue.includes('function') && textValue.includes('schema cache'));
}

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are required');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function handleSwitchAccountModeRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Method Not Allowed', 'METHOD_NOT_ALLOWED', 405);

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return fail('Unauthorized', 'UNAUTHORIZED', 401);

  const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabaseAuth.auth.getUser();

  if (userError || !user?.id) return fail('Unauthorized', 'UNAUTHORIZED', 401);

  const body = await req.json().catch(() => ({}));
  const targetMode = text(body?.target_mode).toLowerCase();
  if (!ACCOUNT_TYPES.has(targetMode)) return fail('target_mode must be solo or company', 'INVALID_TARGET_MODE', 400);

  const {
    data: { user: adminUser },
    error: adminUserError,
  } = await supabaseAdmin.auth.admin.getUserById(user.id);

  if (adminUserError) {
    console.warn('[switch-account-mode] LOAD_AUTH_USER_WARNING', {
      actor_user_id: user.id,
      error: adminUserError,
    });
  }

  const authoritativeUser = adminUser?.id ? adminUser : user;
  const currentMetadata = authoritativeUser.user_metadata || user.user_metadata || {};
  const currentMode = text(currentMetadata?.account_type).toLowerCase() === 'solo' ? 'solo' : 'company';

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !profile) return fail('Profile not found', 'PROFILE_NOT_FOUND', 404);
  if (text(profile.role).toLowerCase() !== 'admin') return fail('Forbidden', 'FORBIDDEN', 403);

  const companyId = text(profile.company_id) || null;
  if (!companyId) return fail('Company not found', 'COMPANY_NOT_FOUND', 400);
  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .select('work_mode')
    .eq('id', companyId)
    .maybeSingle();
  if (companyError || !company) return fail('Company not found', 'COMPANY_NOT_FOUND', 404);
  const previousWorkMode = text(company.work_mode).toLowerCase() === 'solo' ? 'solo' : 'company';
  let switchDetails: Record<string, unknown> | null = null;

  if (targetMode === 'solo') {
    const consentBlockMembers = bool(body?.confirm_block_members);
    const consentReassignOrders = bool(body?.confirm_reassign_orders);
    const consentKeepLicensesIdle = bool(body?.confirm_keep_licenses_idle);
    if (!consentBlockMembers || !consentReassignOrders || !consentKeepLicensesIdle) {
      return fail('Missing required confirmations', 'CONSENT_REQUIRED', 409, {
        confirm_block_members: consentBlockMembers,
        confirm_reassign_orders: consentReassignOrders,
        confirm_keep_licenses_idle: consentKeepLicensesIdle,
      });
    }
  }

  try {
    if (targetMode === 'solo') {
      const { data: members, error: membersError } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('company_id', companyId)
        .neq('id', user.id);

      if (membersError) {
        console.error('[switch-account-mode] LOAD_MEMBERS_FAILED', {
          company_id: companyId,
          actor_user_id: user.id,
          error: membersError,
        });
        throw opFail('Unable to read company members', 'LOAD_MEMBERS_FAILED', {
          db_error: membersError.message || null,
        });
      }
      const otherMemberIds = (Array.isArray(members) ? members : [])
        .map((row) => text(row?.id))
        .filter(Boolean);

      // Block members first, then reassign orders. This avoids partial order reassignment
      // when profile blocking fails.
      if (otherMemberIds.length > 0) {
        const { error: blockMembersError } = await supabaseAdmin
          .from('profiles')
          .update({
            is_admin_blocked: true,
            blocked_reason: 'admin_block',
          })
          .eq('company_id', companyId)
          .neq('id', user.id);

        if (blockMembersError) {
          console.error('[switch-account-mode] BLOCK_MEMBERS_FAILED', {
            company_id: companyId,
            actor_user_id: user.id,
            target_member_count: otherMemberIds.length,
            error: blockMembersError,
          });
          throw opFail('Unable to block members', 'BLOCK_MEMBERS_FAILED', {
            db_error: blockMembersError.message || null,
          });
        }
      }

      const { data: normalizeRows, error: assignedError } = await supabaseAdmin.rpc(
        'normalize_orders_for_solo_mode',
        {
          p_company_id: companyId,
          p_admin_user_id: user.id,
          p_silent_notifications: true,
        },
      );
      if (assignedError) {
        console.error('[switch-account-mode] REASSIGN_ORDERS_FAILED', {
          company_id: companyId,
          actor_user_id: user.id,
          error: assignedError,
        });
        throw opFail('Unable to reassign orders', 'REASSIGN_ORDERS_FAILED', {
          db_error: assignedError.message || null,
        });
      }
      const normalizeRow = Array.isArray(normalizeRows) ? normalizeRows[0] : normalizeRows;
      const reassignedCount = Number(normalizeRow?.reassigned_count || 0);
      const feedToNewCount = Number(normalizeRow?.feed_to_new_count || 0);
      if (
        !Number.isFinite(reassignedCount) ||
        reassignedCount < 0 ||
        !Number.isFinite(feedToNewCount) ||
        feedToNewCount < 0
      ) {
        console.error('[switch-account-mode] REASSIGN_ORDERS_FAILED', {
          company_id: companyId,
          actor_user_id: user.id,
          reassigned_count: reassignedCount,
          feed_to_new_count: feedToNewCount,
        });
        throw opFail('Unable to reassign orders', 'REASSIGN_ORDERS_FAILED', {
          db_error: 'Invalid reassign summary',
        });
      }

      try {
        await supabaseAdmin.from('messenger_integrations').upsert(
          ['telegram', 'max'].map((provider) => ({
            company_id: companyId,
            provider,
            destination_type: 'assignee',
            destination_user_id: user.id,
          })),
          { onConflict: 'company_id,provider' },
        );
      } catch {
        // Non-critical.
      }

      switchDetails = {
        blocked_members_count: otherMemberIds.length,
        reassigned_orders_count: reassignedCount,
        feed_to_new_count: feedToNewCount,
        released_licenses_count: otherMemberIds.length,
        release_licenses_failed_count: 0,
      };
    } else if (targetMode === 'company') {
      const ensureSubscriptionPayloads = [
        {
          p_company_id: companyId,
          p_paid_seats_total: 10,
          p_owner_seats: 1,
          p_free_member_seats: 9,
          p_trial_days: 14,
        },
        { p_company_id: companyId },
      ];
      let ensureSubscriptionError: unknown = null;

      for (const payload of ensureSubscriptionPayloads) {
        const { data: subscription, error: subscriptionError } = await supabaseAdmin.rpc(
          'ensure_company_subscription',
          payload,
        );
        if (!subscriptionError) {
          const row = Array.isArray(subscription) ? subscription[0] : subscription;
          switchDetails = {
            trial_licenses_count: Number(row?.paid_seats_total || 0) || 0,
          };
          ensureSubscriptionError = null;
          break;
        }
        ensureSubscriptionError = subscriptionError;
        if (!isRpcSignatureMismatch(subscriptionError)) break;
      }

      if (ensureSubscriptionError) {
        console.error('[switch-account-mode] ENSURE_COMPANY_SUBSCRIPTION_FAILED', {
          company_id: companyId,
          actor_user_id: user.id,
          error: ensureSubscriptionError,
        });
        throw opFail('Unable to prepare company trial licenses', 'LICENSE_INIT_FAILED', {
          db_error: (ensureSubscriptionError as { message?: string })?.message || null,
        });
      }
    }

    // This is the authoritative mode for database-side finance calculations.
    // The company trigger refreshes only open request snapshots; completed
    // requests remain historical records.
    const { error: workModeError } = await supabaseAdmin
      .from('companies')
      .update({ work_mode: targetMode })
      .eq('id', companyId);
    if (workModeError) {
      console.error('[switch-account-mode] UPDATE_COMPANY_WORK_MODE_FAILED', {
        company_id: companyId,
        actor_user_id: user.id,
        target_mode: targetMode,
        error: workModeError,
      });
      throw opFail('Unable to update company work mode', 'WORK_MODE_UPDATE_FAILED', {
        db_error: workModeError.message || null,
      });
    }
  } catch (error) {
    const opError = (error as { __operation_failed?: boolean; message?: string; code?: string; details?: Record<string, unknown> | null }) || {};
    const message = opError.message || 'Unable to switch account mode';
    const code = opError.code || 'SWITCH_ACCOUNT_MODE_FAILED';
    console.error('[switch-account-mode] SWITCH_ACCOUNT_MODE_FAILED', {
      company_id: companyId,
      actor_user_id: user.id,
      target_mode: targetMode,
      code,
      message,
      details: opError.details || null,
    });
    return json({
      success: false,
      message,
      code,
      details: {
      ...(opError.details || {}),
      metadata_changed: false,
      },
    });
  }

  const metadata = { ...currentMetadata, account_type: targetMode };
  let metadataSyncFailed = false;
  let metadataSyncError: string | null = null;

  if (currentMode !== targetMode) {
    const { error: updateUserError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: metadata,
    });
    if (updateUserError) {
      console.error('[switch-account-mode] UPDATE_USER_METADATA_FAILED', {
        company_id: companyId,
        actor_user_id: user.id,
        target_mode: targetMode,
        error: updateUserError,
      });
      if (targetMode === 'solo') {
        metadataSyncFailed = true;
        metadataSyncError = updateUserError.message || null;
      } else {
        const { error: rollbackWorkModeError } = await supabaseAdmin
          .from('companies')
          .update({ work_mode: previousWorkMode })
          .eq('id', companyId);
        if (rollbackWorkModeError) {
          console.error('[switch-account-mode] ROLLBACK_COMPANY_WORK_MODE_FAILED', {
            company_id: companyId,
            actor_user_id: user.id,
            rollback_mode: previousWorkMode,
            error: rollbackWorkModeError,
          });
        }
        return fail(updateUserError.message || 'Unable to update account mode', 'UPDATE_USER_METADATA_FAILED', 500);
      }
    }
  }

  return json({
    success: true,
    changed: currentMode !== targetMode,
    account_type: targetMode,
    details: {
      ...(switchDetails || {}),
      ...(metadataSyncFailed
        ? {
            metadata_sync_failed: true,
            metadata_sync_error: metadataSyncError,
          }
        : {}),
    },
  });
}
