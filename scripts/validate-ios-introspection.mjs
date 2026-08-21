import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const expoCli = require.resolve('expo/bin/cli');
const result = spawnSync(process.execPath, [expoCli, 'config', '--type', 'introspect', '--json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

if (result.status !== 0) {
  const diagnostic = String(result.stderr || result.stdout || 'unknown Expo introspection error')
    .trim()
    .slice(-2000);
  throw new Error(`Expo iOS introspection failed: ${diagnostic}`);
}

let config;
try {
  config = JSON.parse(result.stdout);
} catch {
  throw new Error('Expo iOS introspection did not return valid JSON');
}

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const ios = config.ios || {};
const info = ios.infoPlist || {};
const privacy = ios.privacyManifests || {};
const forbiddenUsageKeys = [
  'NSContactsUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSPhotoLibraryUsageDescription',
];

check(ios.bundleIdentifier === 'com.monitorapp.monitor', 'Unexpected iOS bundle identifier');
check(/^\d+$/.test(String(ios.buildNumber || '')), 'iOS build number is missing');
check(ios.runtimeVersion === config.version, 'iOS runtime version must match the app version');
check(
  info.NSAppTransportSecurity?.NSAllowsArbitraryLoads === false,
  'App Transport Security must reject arbitrary loads',
);
check(info.ITSAppUsesNonExemptEncryption === false, 'Export compliance flag is inconsistent');
check(Boolean(info.NSCameraUsageDescription), 'Camera usage description is missing');
check(Boolean(info.NSPhotoLibraryAddUsageDescription), 'Photo-add usage description is missing');
for (const key of forbiddenUsageKeys) {
  check(!Object.hasOwn(info, key), `${key} must not be emitted by config plugins`);
}
check(
  info.UIBackgroundModes?.includes('processing') &&
    info.BGTaskSchedulerPermittedIdentifiers?.includes(
      'com.expo.modules.backgroundtask.processing',
    ),
  'iOS background processing configuration is incomplete',
);
check(privacy.NSPrivacyTracking === false, 'iOS privacy tracking must stay disabled');
check(
  privacy.NSPrivacyCollectedDataTypes?.length === 16 &&
    privacy.NSPrivacyCollectedDataTypes.every(
      (entry) =>
        entry.NSPrivacyCollectedDataTypeLinked === true &&
        entry.NSPrivacyCollectedDataTypeTracking === false &&
        entry.NSPrivacyCollectedDataTypePurposes?.includes(
          'NSPrivacyCollectedDataTypePurposeAppFunctionality',
        ),
    ),
  'Collected-data privacy inventory was not emitted intact',
);
check(
  privacy.NSPrivacyAccessedAPITypes?.length >= 4,
  'Required-reason API declarations were not emitted intact',
);

if (failures.length) {
  console.error('iOS introspection validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('iOS introspection validation passed.');
