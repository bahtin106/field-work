#!/usr/bin/env node
/* eslint-disable no-console */
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

function parseIntSafe(v) {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function readDfViaSsh() {
  const host = process.env.VPS_SSH_HOST;
  if (!host) return null;

  const user = process.env.VPS_SSH_USER || 'root';
  const port = process.env.VPS_SSH_PORT || '22';
  const keyPath = process.env.VPS_SSH_KEY_PATH;
  const cmd = process.env.VPS_SSH_COMMAND || 'df -B1 --output=size,used,avail / | tail -1';

  const sshParts = ['ssh', '-o', 'StrictHostKeyChecking=no', '-p', String(port)];
  if (keyPath) sshParts.push('-i', `"${keyPath}"`);
  sshParts.push(`${user}@${host}`, `"${cmd}"`);
  const full = sshParts.join(' ');

  const out = execSync(full, { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').trim();
  const cols = out.split(/\s+/).filter(Boolean);
  if (cols.length < 2) {
    throw new Error(`Unexpected df output: ${out}`);
  }

  const totalBytes = parseIntSafe(cols[0]);
  const usedBytes = parseIntSafe(cols[1]);
  const availBytes = cols.length >= 3 ? parseIntSafe(cols[2]) : null;

  if (totalBytes == null || usedBytes == null) {
    throw new Error(`Cannot parse df output: ${out}`);
  }

  return { totalBytes, usedBytes, availBytes, raw: out };
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const sourceCode = process.env.VPS_STORAGE_SOURCE_CODE || 'main_vps';
  const sourceName = process.env.VPS_STORAGE_SOURCE_NAME || 'Main VPS';
  const provider = process.env.VPS_PROVIDER || null;
  const planName = process.env.VPS_PLAN_NAME || null;
  const quotaBytes = parseIntSafe(process.env.VPS_STORAGE_QUOTA_BYTES);
  const pruneEnabled = String(process.env.VPS_STORAGE_PRUNE_ENABLED || 'true').toLowerCase() !== 'false';
  const retainHoursRaw = parseIntSafe(process.env.VPS_STORAGE_RETAIN_HOURS);
  const retainHours = retainHoursRaw != null && retainHoursRaw >= 24 ? retainHoursRaw : 36;

  const manualUsed = parseIntSafe(process.env.VPS_STORAGE_USED_BYTES);
  const manualTotal = parseIntSafe(process.env.VPS_STORAGE_TOTAL_BYTES);
  const manualAvail = parseIntSafe(process.env.VPS_STORAGE_AVAILABLE_BYTES);
  const manualMediaBytes = parseIntSafe(process.env.VPS_STORAGE_MEDIA_BYTES);
  const manualSystemBytes = parseIntSafe(process.env.VPS_STORAGE_SYSTEM_BYTES);

  let metric = null;
  if (manualUsed != null) {
    metric = {
      usedBytes: manualUsed,
      totalBytes: manualTotal,
      availBytes: manualAvail,
      raw: 'manual-env',
    };
  } else {
    metric = readDfViaSsh();
  }

  if (!metric || metric.usedBytes == null) {
    throw new Error('No metric source configured. Set VPS_STORAGE_USED_BYTES or VPS_SSH_HOST');
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const payload = {
    p_source_code: sourceCode,
    p_source_name: sourceName,
    p_provider: provider,
    p_plan_name: planName,
    p_quota_bytes: quotaBytes,
    p_filesystem_total_bytes: metric.totalBytes,
    p_used_bytes: metric.usedBytes,
    p_available_bytes: metric.availBytes,
    p_measured_at: new Date().toISOString(),
    p_raw: {
      source: 'push-vps-storage-metric',
      raw: metric.raw,
      media_bytes: manualMediaBytes,
      system_bytes:
        manualSystemBytes != null
          ? manualSystemBytes
          : manualMediaBytes != null
            ? Math.max(metric.usedBytes - manualMediaBytes, 0)
            : null,
    },
  };

  const { data, error } = await supabase.rpc('admin_record_storage_metric', payload);
  if (error) throw error;

  console.log('Storage metric pushed:', data);

  if (pruneEnabled) {
    const { data: pruned, error: pruneError } = await supabase.rpc('admin_prune_storage_metrics', {
      p_retain: `${retainHours} hours`,
    });
    if (pruneError) {
      console.error('[push-vps-storage-metric] prune failed:', pruneError?.message || pruneError);
    } else {
      console.log(`Storage metrics pruned: ${Number(pruned || 0)} (retain ${retainHours}h)`);
    }
  }
}

main().catch((err) => {
  console.error('[push-vps-storage-metric] failed:', err?.message || err);
  process.exit(1);
});
