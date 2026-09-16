const { getDefaultConfig } = require('expo/metro-config');
const { spawnSync } = require('node:child_process');

function requireWindowsWatchman() {
  if (process.platform !== 'win32') return;
  const where = spawnSync('where.exe', ['watchman.exe'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const executable = String(where.stdout || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  const probe = executable
    ? spawnSync(executable, ['version'], { encoding: 'utf8', windowsHide: true })
    : null;
  if (!probe || probe.status !== 0) {
    throw new Error(
      'Watchman is required for Metro on Windows. Run `winget install facebook.watchman`, then restart the terminal.',
    );
  }
}

requireWindowsWatchman();

const config = getDefaultConfig(__dirname);
// On Windows, Metro's fallback watcher opens a watcher for every directory and
// can exhaust the process handle limit in a large Expo project. Watchman uses a
// single native project watch and is Metro's supported scalable watcher.
config.resolver.useWatchman = true;

const defaultBlockList = Array.isArray(config.resolver.blockList)
  ? config.resolver.blockList
  : config.resolver.blockList
    ? [config.resolver.blockList]
    : [];

config.resolver.blockList = [
  ...defaultBlockList,
  // Gradle creates tens of thousands of files inside both the app and native
  // dependencies. They are build products, never JavaScript module sources.
  /(?:^|[\\/])android[\\/](?:app[\\/])?(?:build|\.cxx|\.gradle)(?:[\\/]|$)/,
  // Metro only needs JavaScript package entrypoints; native project trees are
  // consumed by Gradle/Xcode and add thousands of Windows watcher handles.
  /(?:^|[\\/])node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+[\\/](?:android|ios|apple|windows|macos)(?:[\\/]|$)/,
  /(?:^|[\\/])node_modules[\\/]react-native[\\/](?:ReactAndroid|ReactCommon|React|ReactApple)(?:[\\/]|$)/,
  // Deno's npm compatibility cache contains a large junction graph that is
  // unrelated to the React Native bundle.
  /(?:^|[\\/])node_modules[\\/]\.deno(?:[\\/]|$)/,
];

// A single Windows transformer worker bounds concurrent file reads while
// Watchman handles filesystem notifications outside the Node process.
const safeWorkerCount = process.platform === 'win32' ? 1 : 2;
config.maxWorkers = Math.min(config.maxWorkers || safeWorkerCount, safeWorkerCount);

module.exports = config;
