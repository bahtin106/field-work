import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TASKS = {
  apk: 'assembleRelease',
  aab: 'bundleRelease',
  clean: 'clean',
};

const target = process.argv[2];
const task = TASKS[target];

if (!task) {
  console.error('Usage: npm run build:android:apk | build:android:aab | build:android:clean');
  process.exit(1);
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const androidDir = join(rootDir, 'android');
const EXPECTED_PLAY_SHA1 = '4E:69:4F:24:AA:19:F3:3B:B5:C3:74:10:7D:27:ED:5B:D2:6D:71:17';
const credentialsPath = join(rootDir, 'credentials.json');
const bundlePath = join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
const gradleCommand = process.platform === 'win32' ? 'cmd.exe' : './gradlew';
const gradleArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'gradlew.bat', task] : [task];

function keytoolCommand() {
  const executable = process.platform === 'win32' ? 'keytool.exe' : 'keytool';
  return process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', executable) : executable;
}

function readSha1(output) {
  const match = String(output || '').match(/SHA1:\s*([0-9A-F:]+)/i);
  return String(match?.[1] || '').trim().toUpperCase();
}

function runKeytool(args) {
  const result = spawnSync(keytoolCommand(), args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error('Android signing certificate could not be read. Refresh credentials from EAS.');
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function loadPlayCredentials() {
  if (!existsSync(credentialsPath)) {
    throw new Error('credentials.json is missing. Download production Android credentials from EAS first.');
  }
  const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'))?.android?.keystore;
  if (!credentials?.keystorePath || !credentials?.keystorePassword || !credentials?.keyAlias) {
    throw new Error('credentials.json does not contain complete Android production credentials.');
  }
  const keystorePath = isAbsolute(credentials.keystorePath)
    ? credentials.keystorePath
    : resolve(rootDir, credentials.keystorePath);
  if (!existsSync(keystorePath)) throw new Error('The production Android keystore file is missing.');
  const sha1 = readSha1(
    runKeytool([
      '-list',
      '-v',
      '-keystore',
      keystorePath,
      '-storepass',
      credentials.keystorePassword,
      '-alias',
      credentials.keyAlias,
    ]),
  );
  if (sha1 !== EXPECTED_PLAY_SHA1) {
    throw new Error(`Refusing to build: Android upload certificate is ${sha1 || 'unknown'}, expected ${EXPECTED_PLAY_SHA1}.`);
  }
  return sha1;
}

function verifyBundle() {
  if (!existsSync(bundlePath)) throw new Error('Gradle completed without producing app-release.aab.');
  const sha1 = readSha1(runKeytool(['-printcert', '-jarfile', bundlePath]));
  if (sha1 !== EXPECTED_PLAY_SHA1) {
    throw new Error(`Refusing to publish: AAB certificate is ${sha1 || 'unknown'}, expected ${EXPECTED_PLAY_SHA1}.`);
  }

  const appConfig = JSON.parse(readFileSync(join(rootDir, 'app.json'), 'utf8'))?.expo;
  const version = String(appConfig?.version || 'unknown');
  const versionCode = Number(appConfig?.android?.versionCode || 0);
  const releasesDir = join(rootDir, 'releases');
  const releasePath = join(releasesDir, `Monitor-${version}-vc${versionCode}-play.aab`);
  mkdirSync(releasesDir, { recursive: true });
  copyFileSync(bundlePath, releasePath);
  const hash = createHash('sha256').update(readFileSync(releasePath)).digest('hex').toUpperCase();
  console.log(`Verified Google Play AAB: ${releasePath}`);
  console.log(`Certificate SHA1: ${sha1}`);
  console.log(`SHA256: ${hash}`);
  console.log(`Size: ${statSync(releasePath).size} bytes`);
}

if (target === 'aab') {
  try {
    console.log(`Using verified Google Play upload certificate: ${loadPlayCredentials()}`);
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}

const child = spawn(gradleCommand, gradleArgs, {
  cwd: androidDir,
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'production',
  },
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Gradle stopped by signal ${signal}`);
    process.exit(1);
  }

  if ((code ?? 1) !== 0) process.exit(code ?? 1);
  if (target === 'aab') {
    try {
      verifyBundle();
    } catch (error) {
      console.error(error?.message || error);
      process.exit(1);
    }
  }
  process.exit(0);
});
