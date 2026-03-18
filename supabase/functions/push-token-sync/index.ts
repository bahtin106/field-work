import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function normalizeError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

function isMissingReminderDelayColumnError(error: unknown) {
  const message = normalizeError(error).toLowerCase();
  return (
    message.includes('notification_prefs') &&
    message.includes('reminder_delay_minutes') &&
    (message.includes('does not exist') || message.includes('could not find'))
  );
}

export async function handlePushTokenSyncRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { ok: false, message: 'POST only' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRole =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SERVICE_ROLE_KEY') ||
      '';
    if (!supabaseUrl || !serviceRole) throw new Error('Missing Supabase env');

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json(401, { ok: false, message: 'Unauthorized' });

    const {
      data: { user },
      error: authErr,
    } = await admin.auth.getUser(token);
    if (authErr || !user?.id) return json(401, { ok: false, message: 'Unauthorized' });

    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      push_token?: string;
      platform?: string;
      device_id?: string;
      enable_notifications?: boolean;
      disable_notifications?: boolean;
      allow?: boolean;
    };

    const action = String(body.action || 'upsert').trim();

    const upsertAllowPrefs = async (allow: boolean) => {
      let supportsReminderDelay = true;
      let prefs: {
        new_orders?: boolean | null;
        feed_orders?: boolean | null;
        reminders?: boolean | null;
        reminder_delay_minutes?: number | null;
        quiet_start?: string | null;
        quiet_end?: string | null;
      } | null = null;

      const fullPrefs = await admin
        .from('notification_prefs')
        .select('new_orders, feed_orders, reminders, reminder_delay_minutes, quiet_start, quiet_end')
        .eq('user_id', user.id)
        .maybeSingle();

      if (fullPrefs.error && isMissingReminderDelayColumnError(fullPrefs.error)) {
        supportsReminderDelay = false;
        const legacyPrefs = await admin
          .from('notification_prefs')
          .select('new_orders, feed_orders, reminders, quiet_start, quiet_end')
          .eq('user_id', user.id)
          .maybeSingle();
        if (legacyPrefs.error) {
          console.error('[push-token-sync][prefs-select-legacy]', normalizeError(legacyPrefs.error));
          throw legacyPrefs.error;
        }
        prefs = legacyPrefs.data;
      } else {
        if (fullPrefs.error) {
          console.error('[push-token-sync][prefs-select]', normalizeError(fullPrefs.error));
          throw fullPrefs.error;
        }
        prefs = fullPrefs.data;
      }

      const prefsRow: {
        user_id: string;
        allow: boolean;
        new_orders: boolean;
        feed_orders: boolean;
        reminders: boolean;
        reminder_delay_minutes?: number;
        quiet_start: string | null;
        quiet_end: string | null;
      } = {
        user_id: user.id,
        allow,
        new_orders: prefs?.new_orders ?? true,
        feed_orders: prefs?.feed_orders ?? true,
        reminders: prefs?.reminders ?? true,
        quiet_start: prefs?.quiet_start ?? null,
        quiet_end: prefs?.quiet_end ?? null,
      };
      if (supportsReminderDelay) {
        prefsRow.reminder_delay_minutes = Number.isFinite(prefs?.reminder_delay_minutes)
          ? Number(prefs?.reminder_delay_minutes)
          : 20;
      }

      const { error: prefErr } = await admin.from('notification_prefs').upsert(
        prefsRow,
        { onConflict: 'user_id' },
      );
      if (prefErr) {
        console.error('[push-token-sync][prefs]', normalizeError(prefErr));
        throw prefErr;
      }
    };

    if (action === 'upsert') {
      const pushToken = String(body.push_token || '').trim();
      if (!pushToken) return json(400, { ok: false, message: 'push_token is required' });
      const platform = String(body.platform || 'unknown').trim() || 'unknown';
      const deviceId = String(body.device_id || '').trim();
      const tokenRow: {
        user_id: string;
        token: string;
        platform: string;
        device_id?: string;
        is_valid: boolean;
        invalid_reason: null;
        last_seen_at: string;
      } = {
        user_id: user.id,
        token: pushToken,
        platform,
        is_valid: true,
        invalid_reason: null,
        last_seen_at: new Date().toISOString(),
      };
      if (deviceId) tokenRow.device_id = deviceId;

      const { error: upErr } = await admin.from('push_tokens').upsert(tokenRow, { onConflict: 'token' });
      if (upErr) {
        console.error('[push-token-sync][upsert]', normalizeError(upErr));
        throw upErr;
      }

      if (deviceId) {
        const { error: invalidateOldErr } = await admin
          .from('push_tokens')
          .update({
            is_valid: false,
            invalid_reason: 'ReplacedByNewerToken',
          })
          .eq('user_id', user.id)
          .eq('device_id', deviceId)
          .neq('token', pushToken)
          .eq('is_valid', true);
        if (invalidateOldErr) {
          console.warn('[push-token-sync][invalidate-old-device-tokens]', normalizeError(invalidateOldErr));
        }
      }

      if (body.enable_notifications !== false) await upsertAllowPrefs(true);

      return json(200, { ok: true });
    }

    if (action === 'set_allow') {
      const allow = body.allow === true;
      await upsertAllowPrefs(allow);
      return json(200, { ok: true });
    }

    if (action === 'delete') {
      const pushToken = String(body.push_token || '').trim();
      let query = admin.from('push_tokens').delete().eq('user_id', user.id);
      if (pushToken) query = query.eq('token', pushToken);
      const { error: delErr } = await query;
      if (delErr) throw delErr;
      if (body.disable_notifications === true) await upsertAllowPrefs(false);
      return json(200, { ok: true });
    }

    return json(400, { ok: false, message: 'Unknown action' });
  } catch (e) {
    const message = normalizeError(e);
    const lowered = message.toLowerCase();
    const status = lowered.includes('unauthorized') ? 401 : 500;
    console.error('[push-token-sync]', status, message);
    return json(status, { ok: false, message });
  }
}

if (import.meta.main) {
  Deno.serve(handlePushTokenSyncRequest);
}
