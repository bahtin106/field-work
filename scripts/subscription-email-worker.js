#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  try {
    const dotenv = require('dotenv');
    const cwd = process.cwd();
    for (const rel of ['.env.local', '.env']) {
      const full = path.join(cwd, rel);
      if (fs.existsSync(full)) dotenv.config({ path: full });
    }
  } catch {
    // dotenv is optional
  }
}

function toInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function normalizeTimeZone(value) {
  const zone = String(value || '').trim();
  if (!zone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return 'UTC';
  }
}

async function sendEmail(emailServiceUrl, payload) {
  const serverToken = String(process.env.EMAIL_SERVER_API_TOKEN || '').trim();
  const response = await fetch(`${emailServiceUrl.replace(/\/$/, '')}/send-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(serverToken ? { 'X-Email-Server-Token': serverToken } : {}),
    },
    body: JSON.stringify(payload),
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
    error:
      !response.ok
        ? body?.error || body?.message || `HTTP ${response.status}`
        : null,
  };
}

async function fetchRuntimeConfig(supabase) {
  const { data, error } = await supabase
    .from('subscription_email_runtime_config')
    .select('batch_limit,processing_timeout_seconds')
    .eq('id', true)
    .single();

  if (error) throw new Error(`load runtime config failed: ${error.message}`);

  return {
    batchLimit: toInt(data?.batch_limit, 100, 1, 500),
    processingTimeoutSeconds: toInt(data?.processing_timeout_seconds, 900, 30, 86400),
  };
}

async function enqueueDueJobs(supabase) {
  const { data, error } = await supabase.rpc('enqueue_due_subscription_email_jobs', {
    p_now: new Date().toISOString(),
  });
  if (error) throw new Error(`enqueue_due_subscription_email_jobs failed: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : null;
  return Number(row?.enqueued_count || 0);
}

async function claimJobs(supabase, limit, processingTimeoutSeconds) {
  const timeoutLiteral = `${Math.max(30, processingTimeoutSeconds)} seconds`;
  const { data, error } = await supabase.rpc('claim_subscription_email_jobs', {
    p_limit: limit,
    p_processing_timeout: timeoutLiteral,
  });
  if (error) throw new Error(`claim_subscription_email_jobs failed: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

async function finishJob(supabase, jobId, success, errorMessage, httpStatus, responseBody) {
  const { error } = await supabase.rpc('finish_subscription_email_job', {
    p_job_id: jobId,
    p_success: success,
    p_error: errorMessage,
    p_http_status: Number.isFinite(httpStatus) ? httpStatus : null,
    p_response: responseBody || null,
  });

  if (error) {
    console.error(`[subscription-email-worker] finish job failed id=${jobId}: ${error.message}`);
  }
}

async function fetchCompanyTimeZones(supabase, companyIds) {
  const ids = Array.from(new Set((Array.isArray(companyIds) ? companyIds : []).filter(Boolean)));
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('companies')
    .select('id, timezone')
    .in('id', ids);
  if (error) throw new Error(`load company timezones failed: ${error.message}`);
  const map = new Map();
  for (const row of Array.isArray(data) ? data : []) {
    map.set(row.id, normalizeTimeZone(row.timezone));
  }
  return map;
}

function buildPayload(job, timeZoneByCompanyId) {
  const payload = job?.payload || {};
  const currentTimeZone = timeZoneByCompanyId?.get?.(job.company_id) || payload.company_timezone || 'UTC';
  return {
    type: 'subscription-reminder',
    email: job.email,
    firstName: payload.first_name || '',
    lastName: payload.last_name || '',
    companyName: payload.company_name || '',
    subscriptionEvent: job.event_type,
    daysLeft: Number.isFinite(Number(payload.days_left)) ? Number(payload.days_left) : 0,
    periodEndIso: payload.period_end_iso || job.period_end_iso || null,
    timeZone: currentTimeZone,
    lang: job.locale || 'ru',
  };
}

async function checkSlaBreaches(supabase) {
  const { data, error } = await supabase.rpc('get_subscription_email_sla_breaches');
  if (error) {
    console.error(`[subscription-email-worker] SLA check failed: ${error.message}`);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

async function main() {
  loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const emailServiceUrl = process.env.EMAIL_SERVICE_URL || process.env.EXPO_PUBLIC_EMAIL_SERVICE_URL;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) are required');
  }
  if (!emailServiceUrl) {
    throw new Error('EMAIL_SERVICE_URL is required for subscription email delivery');
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const runtime = await fetchRuntimeConfig(supabase);
  const limit = toInt(process.env.SUBSCRIPTION_EMAIL_WORKER_LIMIT, runtime.batchLimit, 1, 500);
  // Keep each tick bounded so backlog drain does not monopolize the server CPU.
  const maxBatches = toInt(process.env.SUBSCRIPTION_EMAIL_WORKER_MAX_BATCHES, 5, 1, 200);

  const stats = {
    enqueued: 0,
    claimed: 0,
    sent: 0,
    retriedOrDead: 0,
    failedSend: 0,
    batches: 0,
  };

  stats.enqueued = await enqueueDueJobs(supabase);

  for (let i = 0; i < maxBatches; i += 1) {
    const jobs = await claimJobs(supabase, limit, runtime.processingTimeoutSeconds);
    if (!jobs.length) break;
    const timeZoneByCompanyId = await fetchCompanyTimeZones(
      supabase,
      jobs.map((job) => job.company_id),
    );

    stats.batches += 1;
    stats.claimed += jobs.length;

    for (const job of jobs) {
      try {
        const payload = buildPayload(job, timeZoneByCompanyId);
        if (!payload.email) {
          stats.retriedOrDead += 1;
          await finishJob(supabase, job.id, false, 'email is empty', null, null);
          continue;
        }

        const result = await sendEmail(emailServiceUrl, payload);
        if (result.ok) {
          stats.sent += 1;
          await finishJob(supabase, job.id, true, null, result.status, result.body || { success: true });
        } else {
          stats.failedSend += 1;
          stats.retriedOrDead += 1;
          await finishJob(
            supabase,
            job.id,
            false,
            result.error || 'send-email failed',
            result.status,
            result.body || null,
          );
        }
      } catch (error) {
        stats.failedSend += 1;
        stats.retriedOrDead += 1;
        await finishJob(
          supabase,
          job.id,
          false,
          error?.message || 'unknown worker error',
          null,
          null,
        );
      }
    }
  }

  const breaches = await checkSlaBreaches(supabase);

  console.log(
    `[subscription-email-worker] done: enqueued=${stats.enqueued}, batches=${stats.batches}, claimed=${stats.claimed}, sent=${stats.sent}, failed=${stats.failedSend}`,
  );

  if (breaches.length) {
    for (const b of breaches) {
      console.error(
        `[subscription-email-worker][SLA] metric=${b.metric} value=${b.value} threshold=${b.threshold} severity=${b.severity} message=${b.message}`,
      );
    }
  }
}

main().catch((err) => {
  console.error('[subscription-email-worker] fatal:', err?.message || err);
  process.exit(1);
});
