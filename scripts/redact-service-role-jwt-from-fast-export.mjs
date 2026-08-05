import fs from 'node:fs';
import process from 'node:process';

const mode = process.argv[2] || 'redact';
const serviceJwtPattern = /\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b/g;

if (!new Set(['redact', 'verify']).has(mode)) {
  console.error('Usage: node scripts/redact-service-role-jwt-from-fast-export.mjs [redact|verify]');
  process.exit(2);
}

let buffered = Buffer.alloc(0);
let insideBlob = false;
let pendingDataLength = null;
let pendingDataIsBlob = false;
let redactedConfigCount = 0;
let serviceRoleJwtCount = 0;
let blobDataCount = 0;

function write(buffer) {
  if (mode === 'redact') fs.writeSync(1, buffer);
}

function hasServiceRoleJwt(data) {
  const text = data.toString('utf8');
  serviceJwtPattern.lastIndex = 0;

  for (const match of text.matchAll(serviceJwtPattern)) {
    try {
      const claims = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
      if (claims?.role === 'service_role') return true;
    } catch {
      // A JWT-looking string that cannot be decoded is not a confirmed credential.
    }
  }

  return false;
}

function redactExpoConfig(data) {
  const text = data.toString('utf8');
  if (!text.includes('"supabaseServiceKey"')) return data;

  try {
    const config = JSON.parse(text);
    const extra = config?.expo?.extra;
    if (!extra || !Object.hasOwn(extra, 'supabaseServiceKey')) return data;

    delete extra.supabaseServiceKey;
    redactedConfigCount += 1;
    return Buffer.from(`${JSON.stringify(config, null, 2)}\n`, 'utf8');
  } catch {
    return data;
  }
}

function processAvailableData() {
  while (true) {
    if (pendingDataLength !== null) {
      if (buffered.length < pendingDataLength) return;

      const data = buffered.subarray(0, pendingDataLength);
      buffered = buffered.subarray(pendingDataLength);

      if (pendingDataIsBlob) {
        blobDataCount += 1;
        if (hasServiceRoleJwt(data)) serviceRoleJwtCount += 1;
        const sanitized = mode === 'redact' ? redactExpoConfig(data) : data;
        if (mode === 'redact') {
          write(Buffer.from(`data ${sanitized.length}\n`, 'utf8'));
          write(sanitized);
        }
      } else {
        write(data);
      }

      pendingDataLength = null;
      pendingDataIsBlob = false;
      insideBlob = false;
      continue;
    }

    const lineEnd = buffered.indexOf(0x0a);
    if (lineEnd === -1) return;

    const line = buffered.subarray(0, lineEnd + 1);
    buffered = buffered.subarray(lineEnd + 1);
    const lineText = line.toString('utf8');
    const dataLengthMatch = /^data (\d+)\n$/.exec(lineText);

    if (dataLengthMatch) {
      pendingDataLength = Number(dataLengthMatch[1]);
      pendingDataIsBlob = insideBlob;
      if (!pendingDataIsBlob) write(line);
      continue;
    }

    write(line);
    if (lineText === 'blob\n') insideBlob = true;
  }
}

process.stdin.on('data', (chunk) => {
  buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
  processAvailableData();
});

process.stdin.on('end', () => {
  processAvailableData();

  if (pendingDataLength !== null || buffered.length !== 0) {
    console.error('Invalid or truncated git fast-export stream.');
    process.exit(1);
  }

  if (mode === 'verify' && serviceRoleJwtCount > 0) {
    console.error(`Confirmed service-role JWTs in reachable history: ${serviceRoleJwtCount}`);
    process.exit(1);
  }

  console.error(
    mode === 'redact'
      ? `Redacted Expo service-role configuration blobs: ${redactedConfigCount}`
      : `No literal service-role JWTs found in reachable history (scanned blobs: ${blobDataCount}).`,
  );
});
