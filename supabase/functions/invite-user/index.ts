import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
const EMAIL_SERVICE_URL = String(
  Deno.env.get('EMAIL_SERVICE_URL') ||
    Deno.env.get('EXPO_PUBLIC_EMAIL_SERVICE_URL') ||
    'http://email-server:3000',
).replace(/\/+$/, '');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type InviteBody = {
  email?: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  phone?: string | null;
  birthdate?: string | null;
  role?: string | null;
  department_id?: string | null;
};

function err(message: string, status = 400): Response {
  return Response.json({ success: false, message }, { status, headers: corsHeaders });
}

function generateTempPassword(): string {
  const words = [
    'blue', 'green', 'river', 'stone', 'apple', 'cloud', 'ocean', 'field', 'light', 'power',
    'north', 'south', 'eagle', 'tiger', 'wolf', 'spark', 'sunny', 'magic', 'pilot', 'amber',
  ];
  const rng = new Uint32Array(8);
  crypto.getRandomValues(rng);

  const word = words[rng[0] % words.length];
  const digitsNeeded = Math.max(2, 8 - word.length);
  const digits: string[] = [];
  for (let i = 0; i < digitsNeeded; i += 1) {
    digits.push(String(rng[i + 1] % 10));
  }
  return `${word}${digits.join('')}`;
}

async function cleanupOrphanIdentitiesByEmail(email: string): Promise<number> {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return 0;

  const { data, error } = await sb.rpc('cleanup_auth_identity_orphans', {
    p_email: normalized,
    p_user_id: null,
  });
  if (error) return 0;
  const deleted = Number((data as any)?.deleted ?? 0);
  return Number.isFinite(deleted) ? deleted : 0;
}

async function reconcileEmailBeforeInvite(email: string): Promise<{
  status: 'ok' | 'exists';
  deletedUsers: number;
}> {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return { status: 'ok', deletedUsers: 0 };

  const { data, error } = await sb.rpc('reconcile_email_before_invite', {
    p_email: normalized,
  });
  if (error) {
    return { status: 'ok', deletedUsers: 0 };
  }

  const payload = (data || {}) as { status?: string; deleted_users?: number };
  const status = String(payload.status || 'ok').toLowerCase() === 'exists' ? 'exists' : 'ok';
  const deletedUsers = Number(payload.deleted_users || 0) || 0;
  return { status, deletedUsers };
}

export async function handleInviteUserRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: corsHeaders });

  try {
    const authHeader = req.headers.get('authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return err('Unauthorized', 401);

    const callerClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const {
      data: { user },
      error: authErr,
    } = await callerClient.auth.getUser();
    if (authErr || !user?.id) return err('Unauthorized', 401);

    const { data: callerProfile, error: callerProfileErr } = await sb
      .from('profiles')
      .select('role, company_id')
      .eq('id', user.id)
      .maybeSingle();
    if (callerProfileErr || !callerProfile) return err('Forbidden', 403);
    if (!['admin', 'dispatcher'].includes(String(callerProfile.role || ''))) return err('Forbidden', 403);
    if (!callerProfile.company_id) return err('Caller has no company', 400);

    const body = (await req.json().catch(() => ({}))) as InviteBody;
    const email = String(body.email || '').trim().toLowerCase();
    if (!email) return err('email is required', 400);

    const role = String(body.role || 'worker').trim().toLowerCase();
    if (!['admin', 'dispatcher', 'worker'].includes(role)) return err('invalid role', 400);

    const { data: existingProfile } = await sb
      .from('profiles')
      .select('id')
      .ilike('email', email)
      .maybeSingle();
    if (existingProfile) {
      // If profile exists but auth user is already gone, clean up stale profile and continue invite.
      const { data: existingAuth, error: existingAuthErr } = await sb.auth.admin.getUserById(existingProfile.id);
      if (existingAuthErr || !existingAuth?.user) {
        const { error: staleDeleteErr } = await sb.from('profiles').delete().eq('id', existingProfile.id);
        if (staleDeleteErr) {
          return err(`Failed to cleanup stale profile: ${staleDeleteErr.message}`, 400);
        }
      } else {
        return err('User with this email already exists', 400);
      }
    }

    const reconciliation = await reconcileEmailBeforeInvite(email);
    if (reconciliation.status === 'exists') {
      return err('User with this email already exists', 400);
    }

    const tempPassword = generateTempPassword();
    const createPayload = {
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        first_name: body.first_name || null,
        last_name: body.last_name || null,
        full_name: body.full_name || null,
        invited_by: user.id,
      },
    };
    let { data: created, error: createErr } = await sb.auth.admin.createUser(createPayload);
    if (createErr) {
      const msg = String(createErr.message || 'Create user failed');
      const isIdentityCorruption =
        /database error checking email|database error finding user|unable to find user from email identity/i.test(msg);
      if (isIdentityCorruption) {
        await cleanupOrphanIdentitiesByEmail(email);
        const retry = await sb.auth.admin.createUser(createPayload);
        created = retry.data;
        createErr = retry.error;
      }
    }
    if (createErr) {
      const msg = String(createErr.message || 'Create user failed');
      if (/already.*(exists|registered)|duplicate|email.*(exists|taken|already)/i.test(msg)) {
        return err('User with this email already exists', 400);
      }
      return err(msg, 400);
    }

    const invitedUserId = created?.user?.id;
    if (!invitedUserId) return err('Failed to create invited user', 400);

    const fullName = String(body.full_name || '').trim() ||
      `${String(body.first_name || '').trim()} ${String(body.last_name || '').trim()}`.trim() ||
      null;

    const upsertPayload = {
      id: invitedUserId,
      email,
      first_name: body.first_name || null,
      last_name: body.last_name || null,
      full_name: fullName,
      phone: body.phone || null,
      birthdate: body.birthdate || null,
      role,
      department_id: body.department_id || null,
      company_id: callerProfile.company_id,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await sb.from('profiles').upsert(upsertPayload, { onConflict: 'id' });
    if (upsertErr) {
      await sb.auth.admin.deleteUser(invitedUserId).catch(() => null);
      return err(`Profile save failed: ${upsertErr.message}`, 400);
    }

    const emailRes = await fetch(`${EMAIL_SERVICE_URL}/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'invite',
        email,
        firstName: body.first_name || null,
        lastName: body.last_name || null,
        tempPassword,
      }),
    }).catch((fetchErr) => {
      return { ok: false, status: 0, text: async () => String(fetchErr?.message || 'fetch failed') } as Response;
    });

    if (!emailRes.ok) {
      const details = await emailRes.text().catch(() => '');
      await sb.from('profiles').delete().eq('id', invitedUserId).catch(() => null);
      await sb.auth.admin.deleteUser(invitedUserId).catch(() => null);
      return err(`Email send failed${details ? `: ${details}` : ''}`, 502);
    }

    return Response.json(
      { success: true, user_id: invitedUserId, email, email_sent: true, message: 'Invitation sent' },
      { headers: corsHeaders },
    );
  } catch (e: any) {
    return err(e?.message || 'internal error', 500);
  }
}
