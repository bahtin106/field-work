import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const failures = [];
const configFiles = new Set(['app.json', 'app.config.js', 'app.config.cjs', 'app.config.mjs']);
const literalJwtPattern = /\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b/g;
const committedSecretAssignment = /(?:JWT_SECRET|SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY)\s*[:=]\s*["']?(?!\$\{|process\.env\b|Deno\.env\b|YOUR_|REPLACE_|CHANGE_ME_|<)[A-Za-z0-9._-]{16,}/i;
const forbiddenPublicVariable = /\bEXPO_PUBLIC_(?:SUPABASE_)?(?:SERVICE(?:_ROLE)?_KEY|JWT_SECRET|PRIVATE_KEY)\b/i;
const forbiddenConfigProperty = /\b(?:supabaseServiceKey|serviceRoleKey|jwtSecret)\b/i;

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'buffer',
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function readText(relativePath) {
  const absolutePath = path.join(root, relativePath);
  // `git ls-files --cached` also returns tracked files that are intentionally
  // deleted in the working tree. They have no bytes to inspect.
  if (!fs.existsSync(absolutePath)) return null;
  const source = fs.readFileSync(absolutePath);
  if (source.includes(0)) return null;
  return source.toString('utf8');
}

function jwtRole(tokenPayload) {
  try {
    return JSON.parse(Buffer.from(tokenPayload, 'base64url').toString('utf8'))?.role || null;
  } catch {
    return null;
  }
}

for (const relativePath of trackedFiles()) {
  const source = readText(relativePath);
  if (source === null) continue;

  if (committedSecretAssignment.test(source)) {
    failures.push(`${relativePath}: contains a committed Supabase/JWT secret assignment`);
  }

  if (forbiddenPublicVariable.test(source)) {
    failures.push(`${relativePath}: exposes a privileged key through EXPO_PUBLIC_*`);
  }

  if (configFiles.has(relativePath) && forbiddenConfigProperty.test(source)) {
    failures.push(`${relativePath}: includes a privileged key property in Expo configuration`);
  }

  literalJwtPattern.lastIndex = 0;
  for (const match of source.matchAll(literalJwtPattern)) {
    if (jwtRole(match[1]) === 'service_role') {
      failures.push(`${relativePath}: contains a literal service-role JWT`);
      break;
    }
  }
}

if (failures.length > 0) {
  console.error('Secret exposure check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Secret exposure check passed.');
