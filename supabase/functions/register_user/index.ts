// supabase/functions/register_user/index.ts
// Public registration endpoint.
// Supports check_only mode for availability checks.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_TYPES = new Set(['solo', 'company']);
const PASSWORD_MIN_LENGTH = 8;
const COMPANY_NAME_MAX_LENGTH = 64;
const NAME_MAX_LENGTH = 64;
const SOLO_DEFAULT_COMPANY_NAME = 'Моя компания';

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_CHECK_ONLY = 40;
const RATE_LIMIT_MAX_REGISTER = 10;

const globalState = globalThis as typeof globalThis & {
  __registerRateLimitStore?: Map<string, { count: number; windowStartMs: number }>;
};
const rateLimitStore = globalState.__registerRateLimitStore || new Map();
globalState.__registerRateLimitStore = rateLimitStore;

function text(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeEmail(value: unknown) {
  return text(value).toLowerCase();
}

function normalizeName(value: unknown) {
  return text(value).replace(/\s+/g, ' ');
}

function normalizeCompanyName(value: unknown) {
  return text(value).replace(/\s+/g, ' ');
}

function clipText(value: unknown, maxLen = 2000) {
  const raw = String(value ?? '');
  return raw.length > maxLen ? raw.slice(0, maxLen) : raw;
}

function getAllowedOrigins() {
  const raw = Deno.env.get('REGISTER_ALLOWED_ORIGINS') || '';
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getRequestOrigin(req: Request) {
  return text(req.headers.get('origin') || '');
}

function resolveAllowOrigin(origin: string, allowedOrigins: string[]) {
  if (!allowedOrigins.length) return '*';
  if (origin && allowedOrigins.includes(origin)) return origin;
  return allowedOrigins[0];
}

function buildCorsHeaders(req: Request, allowedOrigins: string[]) {
  const origin = getRequestOrigin(req);
  return {
    'Access-Control-Allow-Origin': resolveAllowOrigin(origin, allowedOrigins),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  };
}

function isOriginAllowed(req: Request, allowedOrigins: string[]) {
  if (!allowedOrigins.length) return true;
  const origin = getRequestOrigin(req);
  if (!origin) return true; // Native apps often omit Origin.
  return allowedOrigins.includes(origin);
}

function getClientIp(req: Request) {
  const xff = text(req.headers.get('x-forwarded-for') || '');
  if (xff) return xff.split(',')[0].trim();
  const realIp = text(req.headers.get('x-real-ip') || '');
  if (realIp) return realIp;
  return 'unknown';
}

function checkRateLimit(clientIp: string, mode: 'check' | 'register') {
  const now = Date.now();
  const key = `${clientIp}|${mode}`;
  const maxAllowed = mode === 'check' ? RATE_LIMIT_MAX_CHECK_ONLY : RATE_LIMIT_MAX_REGISTER;

  const prev = rateLimitStore.get(key);
  if (!prev || now - prev.windowStartMs > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, windowStartMs: now });
    return true;
  }

  if (prev.count >= maxAllowed) {
    return false;
  }

  prev.count += 1;
  rateLimitStore.set(key, prev);
  return true;
}

function jsonResponse(req: Request, allowedOrigins: string[], payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...buildCorsHeaders(req, allowedOrigins) },
  });
}

function errorResponse(
  req: Request,
  allowedOrigins: string[],
  message: string,
  status = 400,
  code?: string,
) {
  return jsonResponse(req, allowedOrigins, { success: false, message, code: code || null }, status);
}

async function logServerIssue(
  supabaseAdmin: ReturnType<typeof createClient>,
  {
    userId = null,
    name = 'RegisterError',
    message,
    stack = null,
    extra = null,
  }: {
    userId?: string | null;
    name?: string;
    message: unknown;
    stack?: unknown;
    extra?: Record<string, unknown> | null;
  },
) {
  try {
    await supabaseAdmin.from('error_logs').insert({
      user_id: userId,
      name: clipText(name, 160),
      message: clipText(message, 2000),
      stack: stack ? clipText(stack, 8000) : null,
      environment: 'prod',
      extra: extra || null,
      app_version: 'edge:register_user',
    });
  } catch (logError) {
    console.warn('register_user: failed to write error_logs', logError);
  }
}

export async function handleRegisterUserRequest(req: Request) {
  const allowedOrigins = getAllowedOrigins();

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(req, allowedOrigins) });
  }

  if (!isOriginAllowed(req, allowedOrigins)) {
    return errorResponse(req, allowedOrigins, 'origin not allowed', 403, 'ORIGIN_NOT_ALLOWED');
  }

  if (req.method !== 'POST') {
    return errorResponse(req, allowedOrigins, 'Method Not Allowed', 405, 'METHOD_NOT_ALLOWED');
  }

  const SUPABASE_URL =
    Deno.env.get('SUPABASE_URL') ||
    Deno.env.get('PROJECT_URL') ||
    Deno.env.get('SUPABASE_PUBLIC_URL') ||
    '';
  const SUPABASE_SERVICE_ROLE_KEY =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return errorResponse(req, allowedOrigins, 'supabase credentials are not configured', 500, 'SERVER_MISCONFIGURED');
  }
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let createdUserId: string | null = null;
  let createdCompanyId: string | null = null;

  try {
    const clientIp = getClientIp(req);
    const body = await req.json().catch(() => ({}));
    const isCheckOnly = body?.check_only === true;

    if (!checkRateLimit(clientIp, isCheckOnly ? 'check' : 'register')) {
      await logServerIssue(supabaseAdmin, {
        name: 'RegisterRateLimit',
        message: 'Registration endpoint rate limit exceeded',
        extra: { clientIp, mode: isCheckOnly ? 'check' : 'register' },
      });
      return errorResponse(req, allowedOrigins, 'Too many requests', 429, 'RATE_LIMITED');
    }

    const accountType = text(body?.account_type);
    const email = normalizeEmail(body?.email);
    const password = String(body?.password ?? '');
    const firstName = normalizeName(body?.first_name);
    const lastName = normalizeName(body?.last_name);
    const fullName = normalizeName(body?.full_name || `${firstName} ${lastName}`);
    const companyNameInput = normalizeCompanyName(body?.company_name);
    const companyTimeZone = text(body?.timezone) || 'UTC';

    if (!ACCOUNT_TYPES.has(accountType)) {
      return errorResponse(req, allowedOrigins, 'account_type must be solo or company', 400, 'INVALID_ACCOUNT_TYPE');
    }

    if (!email || !EMAIL_PATTERN.test(email)) {
      return errorResponse(req, allowedOrigins, 'invalid email', 400, 'INVALID_EMAIL');
    }

    if (!isCheckOnly) {
      if (!password || password.length < PASSWORD_MIN_LENGTH) {
        return errorResponse(req, allowedOrigins, 'password must be at least 8 chars', 400, 'PASSWORD_TOO_SHORT');
      }
      if (!firstName || firstName.length > NAME_MAX_LENGTH) {
        return errorResponse(req, allowedOrigins, 'first_name is required and must be valid', 400, 'INVALID_FIRST_NAME');
      }
      if (!lastName || lastName.length > NAME_MAX_LENGTH) {
        return errorResponse(req, allowedOrigins, 'last_name is required and must be valid', 400, 'INVALID_LAST_NAME');
      }
    }

    if (accountType === 'company') {
      if (!companyNameInput) {
        return errorResponse(
          req,
          allowedOrigins,
          'company_name is required for company account type',
          400,
          'COMPANY_NAME_REQUIRED',
        );
      }
      if (companyNameInput.length > COMPANY_NAME_MAX_LENGTH) {
        return errorResponse(req, allowedOrigins, 'company_name is too long', 400, 'COMPANY_NAME_TOO_LONG');
      }
    }

    const { data: existingUser, error: existingUserError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .limit(1)
      .maybeSingle();

    if (existingUserError) {
      await logServerIssue(supabaseAdmin, {
        name: 'RegisterEmailCheckError',
        message: existingUserError.message,
        extra: { code: existingUserError.code, email },
      });
      return errorResponse(req, allowedOrigins, `email check error: ${existingUserError.message}`, 400, 'EMAIL_CHECK_FAILED');
    }

    let existingCompany = null;
    if (accountType === 'company') {
      const { data, error } = await supabaseAdmin
        .from('companies')
        .select('id')
        .ilike('name', companyNameInput)
        .limit(1)
        .maybeSingle();
      if (error && String(error.code || '') !== 'PGRST116') {
        await logServerIssue(supabaseAdmin, {
          name: 'RegisterCompanyCheckError',
          message: error.message,
          extra: { code: error.code, companyNameInput },
        });
        return errorResponse(req, allowedOrigins, `company check error: ${error.message}`, 400, 'COMPANY_CHECK_FAILED');
      }
      existingCompany = data;
    }

    if (isCheckOnly) {
      return jsonResponse(req, allowedOrigins, {
        success: true,
        email_available: !existingUser,
        company_available: accountType === 'company' ? !existingCompany : true,
      });
    }

    if (existingUser) {
      return errorResponse(req, allowedOrigins, 'User with this email already exists', 400, 'EMAIL_TAKEN');
    }

    if (accountType === 'company' && existingCompany) {
      return errorResponse(req, allowedOrigins, 'Company with this name already exists', 400, 'COMPANY_NAME_TAKEN');
    }

    const metadata: Record<string, unknown> = {
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      role: 'admin',
      account_type: accountType,
    };

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (createErr) {
      const createMessage = String(createErr?.message || 'unknown');
      await logServerIssue(supabaseAdmin, {
        name: 'RegisterAuthCreateError',
        message: createMessage,
        extra: { code: createErr?.code || null, email },
      });
      if (/already|exists/i.test(createMessage)) {
        return errorResponse(req, allowedOrigins, 'User with this email already exists', 400, 'EMAIL_TAKEN');
      }
      return errorResponse(req, allowedOrigins, `Auth create error: ${createMessage}`, 400, 'AUTH_CREATE_FAILED');
    }

    const userId = created?.user?.id;
    if (!userId) {
      return errorResponse(req, allowedOrigins, 'Auth create error: User not created', 400, 'AUTH_CREATE_FAILED');
    }
    createdUserId = userId;

    let companyName = companyNameInput;
    if (accountType === 'solo') {
      companyName = SOLO_DEFAULT_COMPANY_NAME;
    }

    const companyPayloads: Record<string, unknown>[] = [
      { name: companyName, timezone: companyTimeZone, created_by: userId, owner_id: userId },
      { name: companyName, timezone: companyTimeZone, owner_id: userId },
      { name: companyName, timezone: companyTimeZone },
      { name: companyName, created_by: userId, owner_id: userId },
      { name: companyName, owner_id: userId },
      { name: companyName },
    ];
    let newCompany: { id?: string } | null = null;
    let companyErr: { message?: string; code?: string } | null = null;
    for (const payload of companyPayloads) {
      const { data, error } = await supabaseAdmin
        .from('companies')
        .insert(payload)
        .select('id')
        .single();
      if (!error) {
        newCompany = data as { id?: string };
        companyErr = null;
        break;
      }

      const message = String(error.message || '');
      const isMissingColumn =
        String(error.code || '') === '42703' ||
        /column.+does not exist/i.test(message) ||
        /could not find the '.+' column/i.test(message);
      const isOwnerFkRace =
        String(error.code || '') === '23503' && /companies_owner_id_fkey/i.test(message);
      if (isMissingColumn || isOwnerFkRace) {
        companyErr = error as { message?: string; code?: string };
        continue;
      }

      companyErr = error as { message?: string; code?: string };
      break;
    }

    if (companyErr) {
      await logServerIssue(supabaseAdmin, {
        userId,
        name: 'RegisterCompanyCreateError',
        message: companyErr.message,
        extra: { code: companyErr.code || null, companyName, accountType },
      });
      await supabaseAdmin.auth.admin.deleteUser(userId);
      if (String(companyErr?.code || '') === '23505') {
        return errorResponse(req, allowedOrigins, 'Company with this name already exists', 400, 'COMPANY_NAME_TAKEN');
      }
      return errorResponse(req, allowedOrigins, `Company error: ${companyErr.message}`, 400, 'COMPANY_CREATE_FAILED');
    }

    const companyId = newCompany?.id || null;
    createdCompanyId = companyId;

    // Free paid period for 14 days for each new admin/company.
    const { error: ensureSubErr } = await supabaseAdmin.rpc('ensure_company_subscription', {
      p_company_id: companyId,
    });
    if (ensureSubErr) {
      await logServerIssue(supabaseAdmin, {
        userId,
        name: 'RegisterSubscriptionEnsureError',
        message: ensureSubErr.message,
        extra: { code: ensureSubErr.code || null, companyId },
      });
      await supabaseAdmin.from('companies').delete().eq('id', companyId);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return errorResponse(req, allowedOrigins, `Subscription error: ${ensureSubErr.message}`, 400, 'SUBSCRIPTION_INIT_FAILED');
    }

    try {
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...metadata,
          company_id: companyId,
          company_name: companyName,
        },
      });
    } catch (metadataError) {
      await logServerIssue(supabaseAdmin, {
        userId,
        name: 'RegisterMetadataUpdateWarning',
        message: String((metadataError as { message?: string })?.message || metadataError || 'metadata update failed'),
        extra: { companyId },
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    const { data: existingProfile, error: checkErr } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (checkErr) {
      await logServerIssue(supabaseAdmin, {
        userId,
        name: 'RegisterProfileCheckError',
        message: checkErr.message,
        extra: { code: checkErr.code || null },
      });
    }

    const profileData = {
      role: 'admin',
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      email,
      phone: body?.phone ? String(body.phone).replace(/\D/g, '') : null,
      birthdate: body?.birthdate || null,
      company_id: companyId,
    };

    let profileErr = null;
    if (existingProfile) {
      const { error } = await supabaseAdmin.from('profiles').update(profileData).eq('id', userId);
      profileErr = error;
    } else {
      const { error } = await supabaseAdmin.from('profiles').insert({
        id: userId,
        ...profileData,
      });
      profileErr = error;
    }

    if (profileErr) {
      await logServerIssue(supabaseAdmin, {
        userId,
        name: 'RegisterProfileWriteError',
        message: profileErr.message,
        extra: { code: profileErr.code || null, companyId },
      });
      if (companyId) {
        await supabaseAdmin.from('companies').delete().eq('id', companyId);
      }
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return errorResponse(req, allowedOrigins, `Profile error: ${profileErr.message}`, 400, 'PROFILE_WRITE_FAILED');
    }

    if (accountType === 'solo' && companyId) {
      const { error: messengerErr } = await supabaseAdmin
        .from('messenger_integrations')
        .upsert(
          {
            company_id: companyId,
            provider: 'telegram',
            destination_type: 'assignee',
            destination_user_id: userId,
          },
          { onConflict: 'company_id,provider' },
        );
      if (messengerErr) {
        await logServerIssue(supabaseAdmin, {
          userId,
          name: 'RegisterTelegramDefaultRoutingWarning',
          message: messengerErr.message,
          extra: { code: messengerErr.code || null, companyId },
        });
      }
    }

    return jsonResponse(req, allowedOrigins, {
      success: true,
      user_id: userId,
      company_id: companyId,
      role: 'admin',
      account_type: accountType,
      trial_days_granted: 14,
    });
  } catch (e) {
    await logServerIssue(supabaseAdmin, {
      userId: createdUserId,
      name: 'RegisterUnexpectedError',
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : null,
      extra: { createdUserId, createdCompanyId },
    });

    if (createdCompanyId) {
      try {
        await supabaseAdmin.from('companies').delete().eq('id', createdCompanyId);
      } catch {}
    }

    if (createdUserId) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(createdUserId);
      } catch {}
    }

    return errorResponse(
      req,
      allowedOrigins,
      `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      500,
      'INTERNAL_ERROR',
    );
  }
}
