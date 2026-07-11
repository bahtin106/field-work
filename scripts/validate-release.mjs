import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath));
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

const packageJson = json('package.json');
const appJson = json('app.json').expo;
const manifest = read('android/app/src/main/AndroidManifest.xml');
const gradle = read('android/app/build.gradle');
const gradleProperties = read('android/gradle.properties');
const externalUrls = read('config/externalUrls.js');
const financeQueue = read('src/features/finance/queries.js');
const photoQueue = read('src/shared/media/orderPhotoQueue.js');

check(!packageJson.dependencies?.['expo-dev-client'], 'expo-dev-client must not be bundled in production dependencies');
check(packageJson.dependencies?.['expo-background-task'], 'expo-background-task is required for deferred media delivery');

const permissions = new Set(appJson.android?.permissions || []);
const blockedPermissions = new Set(appJson.android?.blockedPermissions || []);
for (const permission of [
  'android.permission.RECORD_AUDIO',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
]) {
  check(!permissions.has(permission), `${permission} must not be requested in app config`);
  check(blockedPermissions.has(permission), `${permission} must be blocked against transitive manifests`);
}

check(/RECORD_AUDIO"\s+tools:node="remove"/.test(manifest), 'Native manifest must remove RECORD_AUDIO');
check(/READ_MEDIA_IMAGES"\s+tools:node="remove"/.test(manifest), 'Native manifest must remove READ_MEDIA_IMAGES');
check(/android\.enableProguardInReleaseBuilds=true/.test(gradleProperties), 'Release minification must be enabled');
check(/android\.enableShrinkResourcesInReleaseBuilds=true/.test(gradleProperties), 'Release resource shrinking must be enabled');

const versionName = gradle.match(/versionName\s*=\s*["']([^"']+)["']/)?.[1];
const versionCode = Number(gradle.match(/versionCode\s*=\s*(\d+)/)?.[1] || 0);
check(versionName === appJson.version, `Native versionName (${versionName}) must match app version (${appJson.version})`);
check(appJson.android?.runtimeVersion === appJson.version, 'Android runtimeVersion must match app version');
check(appJson.ios?.runtimeVersion === appJson.version, 'iOS runtimeVersion must match app version');
check(Number.isInteger(versionCode) && versionCode > 0, 'Android versionCode must be a positive integer');

check(externalUrls.includes('https://monitorapp.ru/data-deletion'), 'Public account deletion URL is required');
check(financeQueue.includes('ownerUserId') && financeQueue.includes('mutateFinanceOutbox'), 'Finance outbox must be owner-scoped and serialized');
check(photoQueue.includes('ownerUserId') && photoQueue.includes('flushOrderPhotoQueue'), 'Photo queue must be owner-scoped and globally flushable');
check(fs.existsSync(path.join(root, 'supabase/migrations/20260712190000_harden_error_logs.sql')), 'Error log schema migration is required');

if (failures.length) {
  console.error('Release validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Release validation passed.');
