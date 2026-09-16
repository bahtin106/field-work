const { getDefaultConfig } = require('expo/metro-config');
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

// Metro owns two worker pools. On Windows, four workers put this project close
// to the per-process open-file ceiling during a cold bundle; two leave enough
// headroom for HMR and Expo's dev-server requests without disabling parallelism.
config.maxWorkers = Math.min(config.maxWorkers || 2, 2);

module.exports = config;
