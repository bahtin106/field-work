import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';

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
    if (existingProfile) return err('User with this email already exists', 400);

    const { data: invited, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(email, {
      redirectTo: 'workorders://auth/verify-email',
      data: {
        first_name: body.first_name || null,
        last_name: body.last_name || null,
        full_name: body.full_name || null,
        invited_by: user.id,
      },
    });
    if (inviteErr) {
      const msg = String(inviteErr.message || 'Invite failed');
      if (/already.*exists|already.*registered|duplicate|email/i.test(msg)) {
        return err('User with this email already exists', 400);
      }
      return err(msg, 400);
    }

    const invitedUserId = invited?.user?.id;
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
    if (upsertErr) return err(`Profile save failed: ${upsertErr.message}`, 400);

    return Response.json(
      { success: true, user_id: invitedUserId, email, message: 'Invitation sent' },
      { headers: corsHeaders },
    );
  } catch (e: any) {
    return err(e?.message || 'internal error', 500);
  }
}
