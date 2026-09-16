// Real native regression test (Expo Go or the project's Android debug build).
// Run this server, adb reverse tcp:8087 tcp:8087, then open exp://127.0.0.1:8087.
// Unlike source-pattern checks this exercises real Image decoding and callbacks.
/* global __dirname, console, process, URL, setTimeout, clearTimeout */
const Metro = require('@expo/metro/metro');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const config = require('../metro.config');
const root = path.resolve(__dirname, '..');
const entry = '/scripts/fixtures/photo-preview/Harness.bundle';
const fixture = fs.readFileSync(path.join(root, 'assets/icon.png'));
const previousResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolved = previousResolver
    ? previousResolver(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
  const file = resolved.filePath?.replaceAll('\\', '/');
  if (file?.endsWith('/lib/supabaseSessionCache.js')) {
    return { type: 'sourceFile', filePath: path.join(__dirname, 'fixtures/photo-preview/session.js') };
  }
  if (file?.endsWith('/config/appRuntime.js')) {
    return { type: 'sourceFile', filePath: path.join(__dirname, 'fixtures/photo-preview/runtimeConfig.js') };
  }
  return resolved;
};
config.watchFolders = [root, ...config.watchFolders];
config.server.port = 8087;
config.server.rewriteRequestUrl = (url) => url.replace('/.expo/.virtual-metro-entry.bundle', entry);
const results = { flaky: 0, auth: 0, unauthorized: 0, events: {} };
let verificationTimer;
let verified = false;
function verifyWhenReady() {
  clearTimeout(verificationTimer);
  if (!['retry:load', 'chain:load', 'failure:error', 'late:load', 'auth:load']
    .every((event) => results.events[event])) return;
  verificationTimer = setTimeout(() => {
    try {
      assert.equal(results.flaky, 2, 'Transient failure must finish after one successful retry');
      assert.equal(results.unauthorized, 0, 'Protected images must carry their session header');
      assert.ok(results.auth >= 2, 'Both the protected tile and changed source must reach the server');
      for (const name of ['retry', 'chain', 'late', 'auth']) {
        assert.equal(results.events[`${name}:load`], 1, `${name}: must not remount after success`);
        assert.equal(results.events[`${name}:error`] || 0, 0, `${name}: must recover`);
      }
      assert.equal(results.events['failure:error'], 1, 'Exhausted retries must reach one terminal error');
      assert.equal(results.events['failure:load'] || 0, 0);
      verified = true;
      console.log('PASS: native retry, fallback chain, late fallback, terminal error, delayed auth.');
      console.log('Visual check required: all four modal tiles must show the blue fixture, also after reopening.');
      console.log(JSON.stringify(results));
    } catch (error) {
      process.exitCode = 1;
      console.error('FAIL:', error.message, JSON.stringify(results));
    }
  }, 3500);
}
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  const url = new URL(req.url, 'http://127.0.0.1:8087');
  if (url.pathname === '/') {
    res.setHeader('Content-Type', 'application/expo+json');
    res.setHeader('expo-protocol-version', '1');
    res.end(JSON.stringify({
      id: randomUUID(), createdAt: new Date().toISOString(),
      runtimeVersion: '57.0.0', assets: [], metadata: {},
      launchAsset: { key: 'bundle', contentType: 'application/javascript',
        url: `http://127.0.0.1:8087${entry}?platform=android&dev=true&minify=false&transform.engine=hermes` },
      extra: {
        scopeKey: '@anonymous/photo-preview-regression',
        eas: { projectId: '2ff49876-1289-40a5-b344-f971aef7a582' },
        expoClient: { name: 'Photo regression', slug: 'photo-preview-regression',
          sdkVersion: '57.0.0', version: '1.0.0', hostUri: '127.0.0.1:8087', extra: {},
          iconUrl: 'http://127.0.0.1:8087/fixture.png', primaryColor: '#ffffff',
          android: { package: 'host.exp.exponent' } },
        expoGo: { debuggerHost: '127.0.0.1:8087', developer: { tool: 'expo-cli' },
          mainModuleName: 'scripts/fixtures/photo-preview/Harness', packagerOpts: { dev: true } },
      },
    }));
    return;
  }
  if (url.pathname === '/status') { res.end('packager-status:running'); return; }
  if (url.pathname === '/results') { res.end(JSON.stringify({ verified, ...results })); return; }
  if (url.pathname === '/event') {
    const event = `${url.searchParams.get('name')}:${url.searchParams.get('event')}`;
    results.events[event] = (results.events[event] || 0) + 1;
    console.log(event);
    verifyWhenReady();
    res.end('ok'); return;
  }
  if (url.pathname === '/denied') { res.statusCode = 403; res.end('fixture: expired URL'); return; }
  if (url.pathname === '/flaky.png') {
    results.flaky += 1;
    console.log('request: flaky', results.flaky);
    // Repeated alternation deliberately exposes success -> remount -> retry loops.
    if (results.flaky % 2) { res.statusCode = 503; res.end('fixture: temporary failure'); return; }
  } else if (url.pathname === '/functions/v1/media-thumbnail') {
    results.auth += 1;
    if (req.headers.authorization !== 'Bearer native-preview-fixture') {
      results.unauthorized += 1;
      res.statusCode = 401; res.end('fixture: missing session'); return;
    }
  } else if (url.pathname !== '/fixture.png') {
    middleware(req, res, next); return;
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.end(fixture);
};
Metro.runServer(config, { host: '127.0.0.1' }).then(() => {
  console.log('Native photo test: exp://127.0.0.1:8087 (requires adb reverse tcp:8087 tcp:8087)');
  console.log('Fresh app launch per server run; results: http://127.0.0.1:8087/results');
});
