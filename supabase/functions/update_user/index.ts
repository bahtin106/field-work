// supabase/functions/update_user/index.ts
// Исправлено:
// 1) НЕ трогаем email в public.profiles (часто такого столбца нет) — email меняем только в auth.
// 2) При любой ошибке возвращаем 200 с { ok:false, message }, чтобы клиент видел текст ошибки, а не generic "non-2xx".
// 3) Обновление роли — в profiles.
// 4) Обновление пароля/почты — в auth.admin.updateUserById.

import { serve } from 'https://deno.land/std@0.210.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleYandexDiskIntegrationRequest } from '../yandex-disk-integration/index.ts';

type ReqBody = {
  user_id: string;
  profile_id?: string | null;
  changed_by?: string | null;
  email?: string | null;
  new_password?: string | null;
  password?: string | null;
  role?: string | null;
  profile?: {
    first_name?: string | null;
    middle_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
    phone?: string | null;
    birthdate?: string | null;
    department_id?: string | null;
  } | null;
  is_admin_blocked?: boolean | null;
  blocked_reason?: string | null;
  is_suspended?: boolean | null;
  suspended_at?: string | null;
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function isUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(
    String(value || '').trim(),
  );
}

function isMissingColumn(error: any, column: string): boolean {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42703' && message.includes(column.toLowerCase());
}

function getBearerToken(req: Request): string {
  return String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

async function getProfileFlexible(admin: any, lookupId: string) {
  const id = String(lookupId || '').trim();
  if (!id) return { data: null, error: null };

  const trySelectBy = async (column: string, selectColumns: string) => admin
    .from('profiles')
    .select(selectColumns)
    .eq(column, id)
    .limit(1)
    .maybeSingle();

  const selectVariants = [
    'id, user_id, role, company_id, email',
    'id, user_id, role, company_id',
    'id, role, company_id',
  ];

  let userIdColumnAvailable = true;
  for (const selectColumns of selectVariants) {
    const byId = await trySelectBy('id', selectColumns);
    if (!byId?.error && byId?.data) return byId;
    if (!byId?.error) break;

    if (isMissingColumn(byId.error, 'email')) continue;
    if (isMissingColumn(byId.error, 'user_id')) {
      userIdColumnAvailable = false;
      continue;
    }

    return byId;
  }

  if (!userIdColumnAvailable) return { data: null, error: null };

  for (const selectColumns of selectVariants) {
    if (!selectColumns.includes('user_id')) continue;
    const byUserId = await trySelectBy('user_id', selectColumns);
    if (!byUserId?.error && byUserId?.data) return byUserId;
    if (!byUserId?.error) break;

    if (isMissingColumn(byUserId.error, 'email')) continue;
    if (isMissingColumn(byUserId.error, 'user_id')) return { data: null, error: null };

    return byUserId;
  }

  return { data: null, error: null };
}

async function resolveAuthUserId(admin: any, actorId: string, actorProfileId: string, targetProfile: any) {
  const targetProfileId = String(targetProfile?.id || '').trim();
  const targetProfileUserId = String(targetProfile?.user_id || '').trim();
  const targetProfileEmail = String(targetProfile?.email || '').trim().toLowerCase();

  if (
    (targetProfileId && actorProfileId && targetProfileId === actorProfileId) ||
    (targetProfileUserId && actorId && targetProfileUserId === actorId)
  ) {
    return actorId;
  }

  const authCandidates = [targetProfileUserId, targetProfileId].filter(
    (v, idx, arr) => !!v && arr.indexOf(v) === idx,
  );
  for (const candidate of authCandidates) {
    if (!isUuid(candidate)) continue;
    const { data, error } = await admin.auth.admin.getUserById(candidate);
    if (!error && data?.user?.id) return String(data.user.id);
  }

  if (targetProfileEmail) {
    let page = 1;
    const perPage = 200;
    for (let i = 0; i < 10; i += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) break;
      const users = data?.users || [];
      const match = users.find((u: any) => String(u?.email || '').trim().toLowerCase() === targetProfileEmail);
      if (match?.id) return String(match.id);
      if (users.length < perPage) break;
      page += 1;
    }
  }

  return '';
}

export async function handleUpdateUserRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, message: 'Method not allowed' }), {
      headers: { 'Content-Type': 'application/json', ...cors },
      status: 200, // чтобы клиент получил текст
    });
  }

  try {
    // Self-hosted fallback:
    // some deployments may route `yandex-disk-integration` traffic to `update_user`.
    // If request looks like Yandex integration action, delegate to the intended handler.
    const bodyProbe = await req.clone().json().catch(() => null);
    const delegatedAction = String(bodyProbe?.action || '').trim().toLowerCase();
    if (
      delegatedAction &&
      ['status', 'start', 'complete', 'disconnect', 'set_folder', 'set_provider', 'set_profile_provider'].includes(
        delegatedAction,
      )
    ) {
      return await handleYandexDiskIntegrationRequest(req);
    }

    const forwardedFor = req.headers.get('x-forwarded-for') || '';
    const ipAddress = forwardedFor.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;
    const userAgent = req.headers.get('user-agent') || null;

    const body = (await req.json()) as ReqBody;
    const rawUserId = String(body?.user_id || '').trim();
    const rawProfileId = String(body?.profile_id || '').trim();
    let targetLookupId = isUuid(rawUserId)
      ? rawUserId
      : isUuid(rawProfileId)
        ? rawProfileId
        : '';

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in function secrets');
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { headers: { 'x-application': 'edge-update-user' } },
    });

    const bearer = getBearerToken(req);
    if (!bearer) throw new Error('Unauthorized');

    const {
      data: { user: actor },
      error: actorErr,
    } = await admin.auth.getUser(bearer);
    if (actorErr || !actor?.id) throw new Error('Unauthorized');

    const {
      user_id,
      changed_by,
      email,
      new_password,
      password,
      role,
      profile,
      is_admin_blocked,
      blocked_reason,
      is_suspended,
    } =
      body;

    const hasPrivilegedFields =
      typeof role === 'string' ||
      typeof is_admin_blocked === 'boolean' ||
      typeof is_suspended === 'boolean' ||
      blocked_reason !== undefined;
    const nextEmail = typeof email === 'string' ? email.trim() : '';
    const nextPassword = password || new_password;
    const needsAuthMutation = !!(nextEmail || (nextPassword && nextPassword.length >= 6));
    if (!targetLookupId && !hasPrivilegedFields) {
      targetLookupId = String(actor.id || '').trim();
    }
    if (!targetLookupId) throw new Error('Invalid user_id');

    const [{ data: actorProfile, error: actorProfileErr }, { data: targetProfile, error: targetProfileErr }] =
      await Promise.all([
        getProfileFlexible(admin, String(actor.id || '')),
        getProfileFlexible(admin, String(targetLookupId || '')),
      ]);
    if (actorProfileErr) {
      console.warn('[UPDATE_USER] Actor profile lookup warning:', actorProfileErr?.message || actorProfileErr);
    }
    if (targetProfileErr) throw new Error('Target profile lookup failed');
    if (!targetProfile?.id) throw new Error('Forbidden');

    const { data: superAdminRow } = await admin
      .from('super_admins')
      .select('user_id, profile_id')
      .eq('is_active', true)
      .or(`user_id.eq.${actor.id},profile_id.eq.${actor.id}`)
      .maybeSingle();

    const targetAuthUserId = await resolveAuthUserId(
      admin,
      String(actor.id || '').trim(),
      String(actorProfile?.id || '').trim(),
      targetProfile,
    );
    const targetProfileId = String(targetProfile.id || '').trim();
    if (needsAuthMutation && (!targetAuthUserId || !isUuid(targetAuthUserId))) {
      throw new Error('Target auth user lookup failed');
    }
    const targetAuthUserIdSafe = isUuid(targetAuthUserId) ? String(targetAuthUserId) : '';
    const targetProfileUserId = String((targetProfile as any)?.user_id || '').trim();

    const actorProfileId = String(actorProfile?.id || actor.id || '').trim();
    const actorRole = String(actorProfile?.role || '').trim().toLowerCase();
    const actorCompanyId = (actorProfile as any)?.company_id ?? null;
    const targetCompanyId = (targetProfile as any)?.company_id ?? null;
    const targetRole = String((targetProfile as any)?.role || '').trim().toLowerCase();

    const isSelf =
      actor.id === targetLookupId ||
      actor.id === user_id ||
      actor.id === targetAuthUserIdSafe ||
      actor.id === targetProfileUserId ||
      actorProfileId === targetLookupId ||
      actorProfileId === user_id ||
      actorProfileId === targetProfileId ||
      actor.id === targetAuthUserIdSafe;
    const isSuperAdmin = !!(superAdminRow?.user_id || superAdminRow?.profile_id) || actorRole === 'super_admin';
    const isCompanyAdmin =
      actorRole === 'admin' &&
      !!actorCompanyId &&
      actorCompanyId === targetCompanyId;
    const isPrivilegedActor = isSuperAdmin || isCompanyAdmin;

    if (!isPrivilegedActor) {
      if (!isSelf || hasPrivilegedFields) throw new Error('Forbidden');
    }

    if (isCompanyAdmin && !isSuperAdmin && targetRole === 'admin' && !isSelf) {
      throw new Error('Forbidden');
    }

    // 1) Обновление полей профиля (если переданы)
    const profilePatch: any = {};
    if (profile && typeof profile === 'object') {
      if ('first_name' in profile) profilePatch.first_name = profile.first_name;
      if ('middle_name' in profile) profilePatch.middle_name = profile.middle_name;
      if ('last_name' in profile) profilePatch.last_name = profile.last_name;
      if ('phone' in profile) profilePatch.phone = profile.phone;
      if ('birthdate' in profile) profilePatch.birthdate = profile.birthdate;
      if ('department_id' in profile) profilePatch.department_id = profile.department_id;
      if ('full_name' in profile) {
        const fullNameCandidate = profile.full_name;
        profilePatch.full_name =
          typeof fullNameCandidate === 'string' ? fullNameCandidate.trim() : fullNameCandidate;
      }
    }
    if (typeof role === 'string' && role.length > 0) {
      profilePatch.role = role;
    }
    const normalizedAdminBlocked =
      typeof is_admin_blocked === 'boolean'
        ? is_admin_blocked
        : typeof is_suspended === 'boolean'
          ? is_suspended
          : null;
    if (typeof normalizedAdminBlocked === 'boolean') {
      profilePatch.is_admin_blocked = normalizedAdminBlocked;
      profilePatch.blocked_reason = normalizedAdminBlocked
        ? String(blocked_reason || 'admin_block')
        : null;
    } else if (blocked_reason !== undefined) {
      profilePatch.blocked_reason = blocked_reason;
    }

    const shouldSyncFullName =
      'first_name' in profilePatch || 'middle_name' in profilePatch || 'last_name' in profilePatch;
    if (shouldSyncFullName) {
      const firstValue =
        typeof profilePatch.first_name === 'string' ? profilePatch.first_name.trim() : '';
      const middleValue =
        typeof profilePatch.middle_name === 'string' ? profilePatch.middle_name.trim() : '';
      const lastValue =
        typeof profilePatch.last_name === 'string' ? profilePatch.last_name.trim() : '';
      const combined = [firstValue, middleValue, lastValue].filter(Boolean).join(' ').trim();
      profilePatch.full_name = combined || null;
    }

    if (Object.keys(profilePatch).length > 0) {
      const { error: profErr } = await admin
        .from('profiles')
        .update(profilePatch)
        .eq('id', targetProfileId);
      if (profErr) throw new Error('Profiles update failed: ' + profErr.message);
    }

    // 2) Email/пароль — только в auth (если переданы)
    const authPatch: { email?: string; password?: string } = {};
    let passwordChanged = false;
    
    if (email && email.trim().length > 0) authPatch.email = email.trim();
    const pwd = password || new_password;
    if (pwd && pwd.length >= 6) {
      authPatch.password = pwd;
      passwordChanged = true;
    }

    if (Object.keys(authPatch).length > 0) {
      if (!targetAuthUserIdSafe) {
        throw new Error('Target auth user lookup failed');
      }
      console.log(`[UPDATE_USER] Updating auth for user ${targetAuthUserIdSafe}:`, {
        hasEmail: !!authPatch.email,
        hasPassword: passwordChanged,
      });
      
      const { error: authErr } = await admin.auth.admin.updateUserById(targetAuthUserIdSafe, authPatch);
      
      if (authErr) {
        console.error(`[UPDATE_USER] Auth update failed for user ${targetAuthUserIdSafe}:`, authErr);
        throw new Error('Auth update failed: ' + authErr.message);
      }
      
      console.log(`[UPDATE_USER] Auth update successful for user ${targetAuthUserIdSafe}`);

      // 3) Логируем изменение пароля в таблицу password_change_log (если существует)
      if (passwordChanged) {
        try {
          console.log(`[UPDATE_USER] Logging password change for user ${targetAuthUserIdSafe}`);
          const { error: logErr } = await admin.rpc('upsert_password_change_log', {
            p_user_id: targetAuthUserIdSafe,
            p_changed_by: actorProfileId || actor.id,
            p_ip_address: ipAddress,
            p_user_agent: userAgent,
            p_source: 'edge:update_user',
            p_window_seconds: 180,
          });
          
          if (logErr) {
            // Логирование — не критично, но выведем в лог
            console.warn(`[UPDATE_USER] Failed to log password change:`, logErr.message);
          } else {
            console.log(`[UPDATE_USER] Password change logged successfully for user ${targetAuthUserIdSafe}`);
          }
        } catch (logException) {
          console.warn(`[UPDATE_USER] Exception while logging password change:`, logException);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', ...cors },
      status: 200,
    });
  } catch (e: any) {
    console.error(`[UPDATE_USER] Error:`, e?.message);
    return new Response(JSON.stringify({ ok: false, message: e?.message ?? 'Unknown error' }), {
      headers: { 'Content-Type': 'application/json', ...cors },
      status: 200, // Всегда 200, чтобы клиент не падал с generic ошибкой
    });
  }
}

if (import.meta.main) {
  serve(handleUpdateUserRequest);
}

