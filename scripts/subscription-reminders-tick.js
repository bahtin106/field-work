#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  try {
    const dotenv = require('dotenv');
    const cwd = process.cwd();
    const candidates = ['.env.local', '.env'];
    for (const rel of candidates) {
      const full = path.join(cwd, rel);
      if (fs.existsSync(full)) {
        dotenv.config({ path: full });
      }
    }
  } catch {
    // dotenv is optional
  }
}

function startOfUtcDay(input) {
  const d = new Date(input);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toIsoDate(input) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function eventByDaysLeft(daysLeft) {
  if (daysLeft <= 0) return 'expired';
  if (daysLeft === 1) return 'warning_1d';
  if (daysLeft === 7) return 'warning_7d';
  return null;
}

function normalizeLang(locale) {
  const code = String(locale || 'ru').toLowerCase();
  return code.startsWith('en') ? 'en' : 'ru';
}

async function sendEmail(emailServiceUrl, payload) {
  const response = await fetch(`${emailServiceUrl.replace(/\/$/, '')}/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const details = body?.error || body?.message || `HTTP ${response.status}`;
    throw new Error(`send-email failed: ${details}`);
  }
  return body || {};
}

async function loadAuthEmail(supabase, profile) {
  const authUserId = profile?.user_id || profile?.id || null;
  if (!authUserId) return null;

  const { data, error } = await supabase.auth.admin.getUserById(authUserId);
  if (error) {
    console.warn(`[subscription-reminders] getUserById failed for ${authUserId}: ${error.message}`);
    return null;
  }
  return data?.user?.email || null;
}

async function main() {
  loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;
  const emailServiceUrl = process.env.EMAIL_SERVICE_URL || 'https://api.monitorapp.ru';
  const now = new Date();
  const todayUtc = startOfUtcDay(now);

  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) are required');
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: subscriptions, error: subsErr } = await supabase
    .from('company_subscriptions')
    .select('company_id,current_period_end,status')
    .not('company_id', 'is', null)
    .not('current_period_end', 'is', null);

  if (subsErr) throw subsErr;

  const targets = (subscriptions || [])
    .map((row) => {
      const periodEnd = new Date(row.current_period_end);
      if (Number.isNaN(periodEnd.getTime())) return null;
      const endDayUtc = startOfUtcDay(periodEnd);
      const daysLeft = Math.round((endDayUtc.getTime() - todayUtc.getTime()) / 86400000);
      const eventType = eventByDaysLeft(daysLeft);
      if (!eventType) return null;
      return {
        companyId: row.company_id,
        currentPeriodEnd: row.current_period_end,
        periodEndDate: toIsoDate(row.current_period_end),
        status: row.status || null,
        daysLeft,
        eventType,
      };
    })
    .filter(Boolean);

  if (!targets.length) {
    console.log('[subscription-reminders] no due reminders');
    return;
  }

  const companyIds = Array.from(new Set(targets.map((x) => x.companyId)));

  const [companiesRes, adminsRes] = await Promise.all([
    supabase.from('companies').select('id,name').in('id', companyIds),
    supabase
      .from('profiles')
      .select('id,user_id,company_id,role,first_name,last_name,full_name,locale,is_suspended')
      .in('company_id', companyIds)
      .eq('role', 'admin'),
  ]);

  if (companiesRes.error) throw companiesRes.error;
  if (adminsRes.error) throw adminsRes.error;

  const companyNameById = new Map((companiesRes.data || []).map((c) => [c.id, c.name || '']));
  const adminsByCompany = new Map();
  for (const profile of adminsRes.data || []) {
    if (profile?.is_suspended) continue;
    const cid = profile.company_id;
    if (!cid) continue;
    if (!adminsByCompany.has(cid)) adminsByCompany.set(cid, []);
    adminsByCompany.get(cid).push(profile);
  }

  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const target of targets) {
    const admins = adminsByCompany.get(target.companyId) || [];
    if (!admins.length) {
      console.warn(`[subscription-reminders] no company admins: ${target.companyId}`);
      continue;
    }

    for (const admin of admins) {
      const periodEndDate = target.periodEndDate;
      if (!periodEndDate) continue;

      const reservePayload = {
        company_id: target.companyId,
        recipient_user_id: admin.id,
        event_type: target.eventType,
        period_end_date: periodEndDate,
        locale: normalizeLang(admin.locale),
      };

      const { data: reserved, error: reserveErr } = await supabase
        .from('subscription_email_notifications')
        .insert(reservePayload)
        .select('id')
        .single();

      if (reserveErr) {
        if (reserveErr.code === '23505') {
          skippedCount += 1;
          continue;
        }
        failedCount += 1;
        console.error('[subscription-reminders] reserve failed:', reserveErr.message);
        continue;
      }

      const reserveId = reserved?.id;
      try {
        const adminEmail = await loadAuthEmail(supabase, admin);
        if (!adminEmail) {
          throw new Error(`admin email not found for ${admin.id}`);
        }

        const lang = normalizeLang(admin.locale);
        const payload = {
          type: 'subscription-reminder',
          email: adminEmail,
          firstName: admin.first_name || '',
          lastName: admin.last_name || '',
          companyName: companyNameById.get(target.companyId) || '',
          subscriptionEvent: target.eventType,
          daysLeft: target.daysLeft,
          periodEndIso: target.currentPeriodEnd,
          lang,
        };

        const emailResult = await sendEmail(emailServiceUrl, payload);

        const patch = {
          sent_at: new Date().toISOString(),
          email: adminEmail,
          locale: lang,
          payload: {
            days_left: target.daysLeft,
            period_end_iso: target.currentPeriodEnd,
            status: target.status,
            message_id: emailResult?.messageId || null,
            email_response: emailResult || null,
          },
        };

        const { error: updErr } = await supabase
          .from('subscription_email_notifications')
          .update(patch)
          .eq('id', reserveId);

        if (updErr) throw updErr;

        sentCount += 1;
        console.log(
          `[subscription-reminders] sent ${target.eventType} to ${adminEmail} for company ${target.companyId}`,
        );
      } catch (err) {
        failedCount += 1;
        console.error('[subscription-reminders] send failed:', err?.message || err);
        if (reserveId) {
          await supabase
            .from('subscription_email_notifications')
            .delete()
            .eq('id', reserveId);
        }
      }
    }
  }

  console.log(
    `[subscription-reminders] done: sent=${sentCount}, skipped=${skippedCount}, failed=${failedCount}`,
  );
}

main().catch((err) => {
  console.error('[subscription-reminders] fatal:', err?.message || err);
  process.exit(1);
});
