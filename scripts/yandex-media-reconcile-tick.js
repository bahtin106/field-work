#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function loadEnv() {
  try {
    const dotenv = require('dotenv');
    const cwd = process.cwd();
    const candidates = ['.env.local', '.env'];
    for (const rel of candidates) {
      const full = path.join(cwd, rel);
      if (fs.existsSync(full)) dotenv.config({ path: full });
    }
  } catch {
    // dotenv optional
  }
}

function parseCliArgs(argv) {
  const args = { limit: 500, dryRun: false, companyId: '' };
  for (const raw of argv.slice(2)) {
    const value = String(raw || '').trim();
    if (!value) continue;
    if (value === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (value.startsWith('--limit=')) {
      const parsed = Number(value.slice('--limit='.length));
      if (Number.isFinite(parsed) && parsed > 0) args.limit = Math.floor(parsed);
      continue;
    }
    if (value.startsWith('--company=')) {
      args.companyId = value.slice('--company='.length).trim();
      continue;
    }
  }
  return args;
}

async function main() {
  loadEnv();
  const cli = parseCliArgs(process.argv);

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const reconcileKey = process.env.YANDEX_RECONCILE_KEY;
  if (!supabaseUrl || !reconcileKey) {
    throw new Error('SUPABASE_URL and YANDEX_RECONCILE_KEY are required');
  }

  const endpoint = `${String(supabaseUrl).replace(/\/$/, '')}/functions/v1/yandex-disk-reconcile`;
  const payload = {
    limit: cli.limit,
    dry_run: cli.dryRun,
    ...(cli.companyId ? { company_id: cli.companyId } : {}),
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-reconcile-key': reconcileKey,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const message = body?.message || `HTTP ${res.status}`;
    throw new Error(`yandex reconcile failed: ${message}`);
  }

  console.log('[yandex-reconcile] ok', JSON.stringify(body));
}

main().catch((err) => {
  console.error('[yandex-reconcile] failed:', err?.message || err);
  process.exit(1);
});

