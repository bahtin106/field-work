const { withAndroidManifest, withInfoPlist } = require('@expo/config-plugins');

const MAP_SCHEMES = ['yandexmaps', 'yandexnavi', 'comgooglemaps'];
const ANDROID_MAP_SCHEMES = [...MAP_SCHEMES, 'geo'];

module.exports = function withMapAppQueries(config) {
  const withAndroidQueries = withAndroidManifest(config, (nextConfig) => {
    const manifest = nextConfig.modResults.manifest;
    manifest.queries ||= [];
    const root = manifest.queries[0] || {};
    root.intent ||= [];
    const existingSchemes = new Set(
      root.intent.flatMap((intent) =>
        (intent.data || []).map((data) => data?.$?.['android:scheme']).filter(Boolean),
      ),
    );
    ANDROID_MAP_SCHEMES.forEach((scheme) => {
      if (existingSchemes.has(scheme)) return;
      root.intent.push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        data: [{ $: { 'android:scheme': scheme } }],
      });
    });
    manifest.queries[0] = root;
    nextConfig.modResults.manifest = manifest;
    return nextConfig;
  });

  return withInfoPlist(withAndroidQueries, (nextConfig) => {
    const current = Array.isArray(nextConfig.modResults.LSApplicationQueriesSchemes)
      ? nextConfig.modResults.LSApplicationQueriesSchemes
      : [];
    nextConfig.modResults.LSApplicationQueriesSchemes = Array.from(
      new Set([...current, ...MAP_SCHEMES]),
    );
    return nextConfig;
  });
};
