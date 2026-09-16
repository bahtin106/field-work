import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') process.exit(0);

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const watchmanConfigPath = join(root, '.watchmanconfig');
const stateDirectory = join(root, '.expo');
const statePath = join(stateDirectory, 'watchman-config-state.json');
const forceReset = process.argv.includes('--force');

function fail(message) {
  console.error(`Metro preflight failed: ${message}`);
  process.exit(1);
}

const where = spawnSync('where.exe', ['watchman.exe'], {
  encoding: 'utf8',
  windowsHide: true,
});
const watchmanExecutable = String(where.stdout || '')
  .split(/\r?\n/)
  .map((value) => value.trim())
  .find(Boolean);
if (!watchmanExecutable) {
  fail('Watchman is required on Windows. Run `winget install facebook.watchman`, then restart the terminal.');
}

function runWatchman(args, { allowFailure = false } = {}) {
  const result = spawnSync(watchmanExecutable, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 && !allowFailure) {
    const detail = String(result.stderr || result.stdout || '').trim();
    fail(`Watchman ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

const versionResult = runWatchman(['version']);
let version = 'unknown';
try {
  version = String(JSON.parse(versionResult.stdout)?.version || version);
} catch {
  fail('Watchman returned invalid version information.');
}

if (!existsSync(watchmanConfigPath)) fail('.watchmanconfig is missing.');
const configSource = readFileSync(watchmanConfigPath, 'utf8');
try {
  JSON.parse(configSource);
} catch {
  fail('.watchmanconfig is not valid JSON.');
}
const configHash = createHash('sha256').update(configSource).digest('hex');

let previousHash = '';
try {
  previousHash = String(JSON.parse(readFileSync(statePath, 'utf8'))?.configHash || '');
} catch {}

const configChanged = previousHash !== configHash;
if (forceReset || configChanged) {
  runWatchman(['watch-del', root], { allowFailure: true });
}

const watchResult = runWatchman(['watch-project', root]);
let watchResponse;
try {
  watchResponse = JSON.parse(watchResult.stdout);
} catch {
  fail('Watchman returned invalid watch-project information.');
}
if (watchResponse?.error) fail(String(watchResponse.error));
if (String(watchResponse?.watcher || '').toLowerCase() !== 'win32') {
  fail(`Watchman did not activate the native Windows watcher (received: ${watchResponse?.watcher || 'unknown'}).`);
}

mkdirSync(stateDirectory, { recursive: true });
writeFileSync(
  statePath,
  `${JSON.stringify({ configHash, version, watch: resolve(root) }, null, 2)}\n`,
  'utf8',
);

console.log(
  forceReset || configChanged
    ? `Metro preflight: Watchman ${version} project watch recreated with the current ignore rules.`
    : `Metro preflight: Watchman ${version} native Windows watcher is ready.`,
);
