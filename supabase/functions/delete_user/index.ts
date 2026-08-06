// supabase/functions/delete_user/index.ts
// Hard delete for employee profiles with explicit company-admin transfer rules.

import { serve } from 'https://deno.land/std@0.210.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { cleanupProfileMediaEntity } from '../profile-media-storage/index.ts';

type ReqBody = {
  action?: 'inspect' | 'delete';
  user_id: string;
  reassign_to?: string | null;
};

type PublicDeleteError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PUBLIC_DELETE_ERROR_MESSAGES: Record<string, string> = {
  USER_ID_REQUIRED: 'User id is required',
  MISSING_AUTH_TOKEN: 'Missing auth token',
  AUTH_FAILED: 'Auth failed',
  PROFILE_NOT_FOUND: 'Profile not found',
  ACCESS_DENIED: 'Access denied',
  CANNOT_DELETE_SELF: 'Cannot delete yourself',
  CANNOT_DELETE_SUPER_ADMIN: 'Cannot delete an active super admin',
  USER_NOT_FOUND: 'User not found',
  SUCCESSOR_REQUIRED: 'Successor is required for delete',
  SUCCESSOR_NOT_FOUND: 'Successor not found',
  SUCCESSOR_BLOCKED: 'Successor is blocked',
  COMPANY_ADMIN_TRANSFER_REQUIRED: 'Company admin transfer is required',
  COMPANY_ADMIN_DELETE_COMPANY_REQUIRED: 'Company deletion is required',
  DELETE_USER_FAILED: 'Delete user failed',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', ...cors },
    status,
  });
}

function publicError(code: string, details?: Record<string, unknown>): PublicDeleteError {
  return {
    code,
    message: PUBLIC_DELETE_ERROR_MESSAGES[code] || PUBLIC_DELETE_ERROR_MESSAGES.DELETE_USER_FAILED,
    ...(details ? { details } : {}),
  };
}

function toPublicDeleteError(error: unknown): PublicDeleteError {
  const raw = String((error as Error)?.message || error || 'DELETE_USER_FAILED');
  let code = PUBLIC_DELETE_ERROR_MESSAGES[raw] ? raw : '';
  if (!code && /missing auth token/i.test(raw)) code = 'MISSING_AUTH_TOKEN';
  if (!code && /auth failed/i.test(raw)) code = 'AUTH_FAILED';
  if (!code && /profile not found/i.test(raw)) code = 'PROFILE_NOT_FOUND';
  if (!code && /access denied|недостаточно прав/i.test(raw)) code = 'ACCESS_DENIED';
  if (!code && /cannot delete yourself/i.test(raw)) code = 'CANNOT_DELETE_SELF';
  if (!code && /user not found/i.test(raw)) code = 'USER_NOT_FOUND';
  if (!code && /successor.*required/i.test(raw)) code = 'SUCCESSOR_REQUIRED';
  if (!code && /successor.*not found/i.test(raw)) code = 'SUCCESSOR_NOT_FOUND';
  if (!code && /successor.*blocked|successor.*suspended/i.test(raw)) code = 'SUCCESSOR_BLOCKED';
  if (!code) code = 'DELETE_USER_FAILED';
  if (code === 'DELETE_USER_FAILED') {
    console.error('[delete_user]', raw);
  }
  return publicError(code);
}

function displayName(profile: any): string {
  return (
    String(profile?.full_name || '').trim() ||
    [profile?.first_name, profile?.middle_name, profile?.last_name]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' ') ||
    String(profile?.email || '').trim() ||
    String(profile?.id || '').trim()
  );
}

function mapCandidate(profile: any): Record<string, unknown> {
  return {
    id: profile.id,
    email: profile.email || null,
    first_name: profile.first_name || null,
    middle_name: profile.middle_name || null,
    last_name: profile.last_name || null,
    full_name: profile.full_name || displayName(profile),
    role: profile.role || 'worker',
    license_state: profile.license_state || 'active',
  };
}

async function getActorContext(admin: any, actorUserId: string) {
  const { data: actorProfile } = await admin
    .from('profiles')
    .select('id, email, role, company_id')
    .eq('id', actorUserId)
    .maybeSingle();

  const { data: superAdminRows, error: superAdminError } = await admin
    .from('super_admins')
    .select('id')
    .eq('is_active', true)
    .or(`user_id.eq.${actorUserId},profile_id.eq.${actorUserId}`)
    .limit(1);

  if (superAdminError) throw superAdminError;

  const isSuperAdmin =
    Array.isArray(superAdminRows) && superAdminRows.length > 0 ||
    String(actorProfile?.role || '').toLowerCase() === 'super_admin';

  if (!actorProfile && !isSuperAdmin) throw new Error('PROFILE_NOT_FOUND');

  return { actorProfile, isSuperAdmin };
}

async function isActiveSuperAdmin(admin: any, profileId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('super_admins')
    .select('id')
    .eq('is_active', true)
    .or(`user_id.eq.${profileId},profile_id.eq.${profileId}`)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function buildDeleteContext(admin: any, target: any) {
  const companyId = target?.company_id || null;
  const company = companyId
    ? await admin
        .from('companies')
        .select('id, name, owner_id')
        .eq('id', companyId)
        .maybeSingle()
        .then(({ data, error }: any) => {
          if (error) throw error;
          return data || null;
        })
    : null;

  const { count: totalOrdersCount, error: totalCountError } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', target.id);
  if (totalCountError) throw totalCountError;

  const { count: activeOrdersCount, error: activeCountError } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', target.id)
    .not('status', 'in', '("completed","cancelled")');
  if (activeCountError) throw activeCountError;

  const { data: candidatesRaw, error: candidatesError } = companyId
    ? await admin
        .from('profiles')
        .select('id, email, first_name, middle_name, last_name, full_name, role, is_admin_blocked, license_state')
        .eq('company_id', companyId)
        .neq('id', target.id)
        .eq('is_admin_blocked', false)
        .in('role', ['admin', 'dispatcher', 'worker'])
        .order('full_name', { ascending: true, nullsFirst: false })
    : { data: [], error: null };

  if (candidatesError) throw candidatesError;

  const candidates = Array.isArray(candidatesRaw) ? candidatesRaw.map(mapCandidate) : [];
  const isCompanyAdmin =
    String(target?.role || '').toLowerCase() === 'admin' ||
    (!!company?.owner_id && String(company.owner_id) === String(target.id));
  const requiresAdminTransfer = isCompanyAdmin && candidates.length > 0;
  const companyDeleteRequired = isCompanyAdmin && candidates.length === 0;
  const hasOrders = Number(totalOrdersCount || 0) > 0;

  return {
    user: {
      id: target.id,
      email: target.email || null,
      full_name: displayName(target),
      role: target.role || null,
      company_id: companyId,
    },
    company: company
      ? {
          id: company.id,
          name: company.name || null,
          owner_id: company.owner_id || null,
        }
      : null,
    orders: {
      total_count: Number(totalOrdersCount || 0),
      active_count: Number(activeOrdersCount || 0),
    },
    candidates,
    is_company_admin: isCompanyAdmin,
    requires_admin_transfer: requiresAdminTransfer,
    company_delete_required: companyDeleteRequired,
    requires_successor: hasOrders || requiresAdminTransfer,
  };
}

async function validateSuccessor(admin: any, successorId: string, companyId: string) {
  const { data: successor, error: successorError } = await admin
    .from('profiles')
    .select('id, company_id, role, is_admin_blocked')
    .eq('id', successorId)
    .maybeSingle();

  if (successorError || !successor) throw new Error('SUCCESSOR_NOT_FOUND');
  if (String(successor.company_id || '') !== String(companyId || '')) {
    throw new Error('SUCCESSOR_NOT_FOUND');
  }
  if (successor.is_admin_blocked) throw new Error('SUCCESSOR_BLOCKED');
  return successor;
}

export async function handleDeleteUserRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, ...publicError('DELETE_USER_FAILED') });
  }

  try {
    const body = (await req.json()) as ReqBody;
    const action = body?.action === 'inspect' ? 'inspect' : 'delete';
    const targetProfileId = String(body?.user_id || '').trim();
    const successorId = String(body?.reassign_to || '').trim() || null;

    if (!targetProfileId) throw new Error('USER_ID_REQUIRED');

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in function secrets');
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { headers: { 'x-application': 'edge-delete-user' } },
    });

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) throw new Error('MISSING_AUTH_TOKEN');

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const actorUserId = authData?.user?.id || null;
    if (authError || !actorUserId) throw new Error('AUTH_FAILED');

    if (targetProfileId === actorUserId) throw new Error('CANNOT_DELETE_SELF');

    const { actorProfile, isSuperAdmin } = await getActorContext(admin, actorUserId);

    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, email, first_name, middle_name, last_name, full_name, company_id, role, is_admin_blocked, license_state')
      .eq('id', targetProfileId)
      .maybeSingle();
    if (targetError || !target) throw new Error('USER_NOT_FOUND');

    const actorIsCompanyAdmin =
      String(actorProfile?.role || '').toLowerCase() === 'admin' &&
      !!actorProfile?.company_id &&
      String(actorProfile.company_id) === String(target.company_id || '');

    if (!isSuperAdmin && !actorIsCompanyAdmin) throw new Error('ACCESS_DENIED');

    if (await isActiveSuperAdmin(admin, target.id)) {
      throw new Error('CANNOT_DELETE_SUPER_ADMIN');
    }

    const context = await buildDeleteContext(admin, target);

    if (action === 'inspect') {
      return jsonResponse({ ok: true, action: 'inspect', ...context });
    }

    if (context.company_delete_required) {
      return jsonResponse({
        ok: false,
        ...publicError('COMPANY_ADMIN_DELETE_COMPANY_REQUIRED', {
          company_id: context.company?.id || null,
        }),
        context,
      });
    }

    if (context.requires_admin_transfer && !successorId) {
      return jsonResponse({
        ok: false,
        ...publicError('COMPANY_ADMIN_TRANSFER_REQUIRED', {
          company_id: context.company?.id || null,
        }),
        context,
      });
    }

    if (context.orders.total_count > 0 && !successorId) {
      return jsonResponse({
        ok: false,
        ...publicError('SUCCESSOR_REQUIRED'),
        context,
      });
    }

    let successor = null;
    if (successorId) {
      if (!context.user.company_id) throw new Error('SUCCESSOR_NOT_FOUND');
      successor = await validateSuccessor(admin, successorId, context.user.company_id);
    }

    if (context.is_company_admin && successor) {
      const { error: transferError } = await admin.rpc(
        'service_transfer_company_admin_for_deletion',
        {
          p_profile_id: target.id,
          p_successor_profile_id: successor.id,
        },
      );
      if (transferError) throw transferError;
    }

    if (successor) {
      const { error: reassignError } = await admin
        .from('orders')
        .update({ assigned_to: successor.id })
        .eq('assigned_to', target.id);
      if (reassignError) throw reassignError;
    }

    const { error: messengerError } = await admin
      .from('messenger_integrations')
      .update({
        is_enabled: false,
        destination_type: 'feed',
        destination_user_id: null,
      })
      .eq('destination_user_id', target.id);
    if (messengerError) throw messengerError;

    if (context.user.company_id) {
      try {
        await cleanupProfileMediaEntity(admin, {
          companyId: String(context.user.company_id),
          entityType: 'employee',
          entityId: target.id,
        });
      } catch (cleanupError) {
        console.error('[delete_user] profile media cleanup failed', cleanupError);
      }
    }

    const { error: deleteProfileError } = await admin
      .from('profiles')
      .delete()
      .eq('id', target.id);
    if (deleteProfileError) throw deleteProfileError;

    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(target.id);
    if (deleteAuthError) throw deleteAuthError;

    const targetEmail = String(target.email || '').trim().toLowerCase();
    await admin.rpc('cleanup_auth_identity_orphans', {
      p_email: targetEmail || null,
      p_user_id: target.id,
    });

    return jsonResponse({
      ok: true,
      deleted_user_id: target.id,
      transferred_admin_to: context.is_company_admin && successor ? successor.id : null,
      reassigned_to: successor ? successor.id : null,
    });
  } catch (error) {
    return jsonResponse({ ok: false, ...toPublicDeleteError(error) });
  }
}

if (import.meta.main) {
  serve(handleDeleteUserRequest);
}
