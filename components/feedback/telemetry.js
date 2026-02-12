// components/feedback/telemetry.js
// Надёжная телеметрия: client → createClient → REST, максимум диагностики в консоль.

let _cfg = {
  supabaseUrl: null,
  supabaseAnonKey: null,
  webhookUrl: null,
  eventsTable: 'events',
  errorsTable: 'error_logs',
  appVersion: null,
  environment: 'production',
  userId: null,
  debug: true, // ВКЛ подробный лог
};

let _supabase = null;

function nowISO() {
  try {
    return new Date().toISOString();
  } catch {
    return null;
  }
}
function redact(s, keep = 6) {
  if (!s || typeof s !== 'string') return s;
  if (s.length <= keep) return '***';
  return s.slice(0, keep) + '…redacted';
}
function dlog(...a) {
  if (_cfg.debug)
    try {
      console.info('[telemetry]', ...a);
    } catch {}
}
function dwarn(...a) {
  try {
    console.warn('[telemetry]', ...a);
  } catch {}
}
function derr(...a) {
  try {
    console.error('[telemetry]', ...a);
  } catch {}
}

function supabaseHeaders() {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    apikey: _cfg.supabaseAnonKey || '',
    Authorization: _cfg.supabaseAnonKey ? `Bearer ${_cfg.supabaseAnonKey}` : '',
    Prefer: 'return=representation',
  };
}

async function postJSON(url, body, headers = {}) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      credentials: 'omit',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => null);
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message || e) };
  }
}

export function initTelemetry(cfg = {}) {
  _cfg = { ..._cfg, ...cfg };

  // 1) попробуем взять готовый клиент из проекта
  try {
    const mod = require('../../lib/supabase');
    _supabase = mod?.supabase || mod?.client || null;
    if (_supabase) dlog('use project supabase client');
  } catch {}

  // 2) если нет — попробуем создать сами
  if (!_supabase && _cfg.supabaseUrl && _cfg.supabaseAnonKey) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      _supabase = createClient(_cfg.supabaseUrl, _cfg.supabaseAnonKey);
      dlog('create supabase client via @supabase/supabase-js');
    } catch (e) {
      dwarn('no @supabase/supabase-js, will use REST fallback:', String(e?.message || e));
    }
  }

  dlog('init', {
    hasClient: !!_supabase,
    hasREST: !!_cfg.supabaseUrl && !!_cfg.supabaseAnonKey,
    hasWebhook: !!_cfg.webhookUrl,
    eventsTable: _cfg.eventsTable,
    errorsTable: _cfg.errorsTable,
    appVersion: _cfg.appVersion,
    env: _cfg.environment,
    supabaseUrl: _cfg.supabaseUrl || null,
    supabaseAnonKey: redact(_cfg.supabaseAnonKey),
  });

  if (!_supabase && (!_cfg.supabaseUrl || !_cfg.supabaseAnonKey) && !_cfg.webhookUrl) {
    dwarn('No Supabase client & no REST/webhook config — telemetry is no-op until configured.');
  }
}

export function setDebug(v) {
  _cfg.debug = !!v;
  dlog('debug', { enabled: _cfg.debug });
}

export function setUser(userId) {
  _cfg.userId = userId || null;
  dlog('setUser', { userId: _cfg.userId });
}

function normalizeError(err) {
  if (!err) return { name: 'Error', message: 'Unknown error', stack: null };
  if (err instanceof Error)
    return { name: err.name, message: err.message, stack: err.stack || null };
  try {
    const str = typeof err === 'string' ? err : JSON.stringify(err);
    return { name: 'NonError', message: str, stack: null };
  } catch {
    return { name: 'NonError', message: 'Unserializable error', stack: null };
  }
}

async function insertWithClient(table, row) {
  if (!_supabase) return { ok: false, status: 0, error: 'no_supabase_client' };
  try {
    // v2 API
    const { data, error } = await _supabase.from(table).insert(row).select().limit(1);
    if (error) return { ok: false, status: 400, error: error.message, details: error };
    return { ok: true, status: 201, data };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message || e) };
  }
}

async function insertWithREST(table, row) {
  if (!_cfg.supabaseUrl || !_cfg.supabaseAnonKey)
    return { ok: false, status: 0, error: 'no_rest_config' };
  const base = _cfg.supabaseUrl.replace(/\/$/, '');
  const url = `${base}/rest/v1/${encodeURIComponent(table)}`;
  const res = await postJSON(url, row, supabaseHeaders());
  if (!res.ok) {
    const hint =
      res.status === 401
        ? 'Unauthorized (401): проверь supabaseAnonKey и URL, ключ должен быть anon public.'
        : String(res.body || '').includes('row level security')
          ? 'RLS: нужна политика INSERT для anon на эту таблицу.'
          : undefined;
    derr('REST insert failed', { table, status: res.status, body: res.body, hint });
  }
  return res;
}

async function tryWebhook(kind, payload) {
  if (!_cfg.webhookUrl) return { ok: false, status: 0, error: 'no_webhook' };
  const res = await postJSON(_cfg.webhookUrl, { kind, ...payload });
  if (!res.ok) derr('Webhook failed', { kind, status: res.status, body: res.body });
  return res;
}

export async function logEvent(type, payload = {}) {
  const event = {
    type,
    payload,
    user_id: _cfg.userId,
    app_version: _cfg.appVersion,
    environment: _cfg.environment,
    ts: nowISO(),
  };

  dlog('logEvent: begin', { type, hasClient: !!_supabase });

  // 1) client
  let r = await insertWithClient(_cfg.eventsTable, event);
  if (r.ok) {
    dlog('logEvent: client OK');
    return true;
  }
  if (r.error) dwarn('logEvent: client FAIL', r);

  // 2) REST
  r = await insertWithREST(_cfg.eventsTable, event);
  if (r.ok) {
    dlog('logEvent: REST OK');
    return true;
  }
  if (!r.ok) dwarn('logEvent: REST FAIL', r);

  // 3) webhook
  r = await tryWebhook('event', event);
  if (r.ok) {
    dlog('logEvent: webhook OK');
    return true;
  }

  dwarn('logEvent: all paths failed', {
    config: {
      hasClient: !!_supabase,
      hasREST: !!_cfg.supabaseUrl && !!_cfg.supabaseAnonKey,
      hasWebhook: !!_cfg.webhookUrl,
    },
  });
  return false;
}

export async function logError(error, extra = {}) {
  const e = normalizeError(error);
  const entry = {
    message: e.message,
    name: e.name,
    stack: e.stack,
    extra,
    user_id: _cfg.userId,
    app_version: _cfg.appVersion,
    environment: _cfg.environment,
    ts: nowISO(),
  };

  dlog('logError: begin', { name: e.name });

  let r = await insertWithClient(_cfg.errorsTable, entry);
  if (r.ok) {
    dlog('logError: client OK');
    return true;
  }
  if (r.error) dwarn('logError: client FAIL', r);

  r = await insertWithREST(_cfg.errorsTable, entry);
  if (r.ok) {
    dlog('logError: REST OK');
    return true;
  }
  if (!r.ok) dwarn('logError: REST FAIL', r);

  r = await tryWebhook('error', entry);
  if (r.ok) {
    dlog('logError: webhook OK');
    return true;
  }

  dwarn('logError: all paths failed', {
    config: {
      hasClient: !!_supabase,
      hasREST: !!_cfg.supabaseUrl && !!_cfg.supabaseAnonKey,
      hasWebhook: !!_cfg.webhookUrl,
    },
  });
  return false;
}

export function installGlobalHandlers({ captureRejections = true } = {}) {
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
      logError(e?.error || e, { where: 'window.error' });
    });
    if (captureRejections) {
      window.addEventListener('unhandledrejection', (e) => {
        logError(e?.reason || e, { where: 'unhandledrejection' });
      });
    }
    dlog('global handlers installed');
  } else {
    dlog('no window — RN/JS runtime, global handlers skipped');
  }
}

export async function pingTelemetry() {
  dlog('ping: start');
  const ok = await logEvent('telemetry_ping', { t: nowISO() });
  if (!ok) {
    dwarn('ping: FAILED — проверь URL/KEY, имена таблиц и RLS (INSERT для anon).');
  } else {
    dlog('ping: OK');
  }
  return ok;
}

