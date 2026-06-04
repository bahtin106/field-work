import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';
import Screen from './Screen';

const loadedScreenCache = new Map();
const loadingScreenCache = new Map();

function resolveScreenModule(mod) {
  return mod?.default || mod;
}

export function preloadLazyRouteScreen(cacheKey, load) {
  const key = String(cacheKey || '').trim();
  if (!key || typeof load !== 'function') return Promise.resolve(null);

  const cachedScreen = loadedScreenCache.get(key);
  if (cachedScreen) return Promise.resolve(cachedScreen);

  const cachedPromise = loadingScreenCache.get(key);
  if (cachedPromise) return cachedPromise;

  const promise = load()
    .then((mod) => {
      const screen = resolveScreenModule(mod);
      if (screen) loadedScreenCache.set(key, screen);
      loadingScreenCache.delete(key);
      return screen || null;
    })
    .catch((error) => {
      loadingScreenCache.delete(key);
      throw error;
    });

  loadingScreenCache.set(key, promise);
  return promise;
}

export default function LazyRouteScreen({
  load,
  titleKey,
  titleFallback,
  cacheKey,
  screenProps,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const resolvedCacheKey = cacheKey || titleKey || titleFallback || null;
  const [LoadedScreen, setLoadedScreen] = React.useState(() =>
    resolvedCacheKey ? loadedScreenCache.get(resolvedCacheKey) || null : null,
  );
  const [loadError, setLoadError] = React.useState(false);
  const loadRef = React.useRef(load);
  const retryNonceRef = React.useRef(0);
  const title = titleKey ? t(titleKey) : titleFallback || t('toast_loading_info');

  React.useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const startLoad = React.useCallback(() => {
    if (resolvedCacheKey) {
      const cachedScreen = loadedScreenCache.get(resolvedCacheKey);
      if (cachedScreen) {
        setLoadedScreen(() => cachedScreen);
        setLoadError(false);
        return Promise.resolve(cachedScreen);
      }
    }

    setLoadError(false);
    const nonce = retryNonceRef.current + 1;
    retryNonceRef.current = nonce;
    const loadPromise = resolvedCacheKey
      ? preloadLazyRouteScreen(resolvedCacheKey, loadRef.current)
      : loadRef.current().then(resolveScreenModule);

    return loadPromise
      .then((screen) => {
        if (retryNonceRef.current !== nonce) return;
        setLoadedScreen(() => screen);
        return screen;
      })
      .catch(() => {
        if (retryNonceRef.current === nonce) setLoadError(true);
      });
  }, [resolvedCacheKey]);

  React.useEffect(() => {
    if (LoadedScreen) return undefined;
    startLoad();
    return undefined;
  }, [LoadedScreen, startLoad]);

  if (LoadedScreen) return <LoadedScreen {...screenProps} />;

  return (
    <Screen background="background" headerOptions={{ title }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg }}>
        {loadError ? (
          <>
            <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginBottom: theme.spacing.md }}>
              {t('refresh_failed')}
            </Text>
            <Pressable
              onPress={startLoad}
              style={({ pressed }) => ({
                minHeight: 40,
                paddingHorizontal: theme.spacing.lg,
                borderRadius: theme.radii?.pill ?? 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.primary,
                opacity: pressed ? 0.88 : 1,
              })}
              accessibilityRole="button"
            >
              <Text
                style={{
                  color: theme.colors.onPrimary || theme.colors.primaryTextOn || '#FFFFFF',
                  fontWeight: theme.typography.weight.semibold,
                }}
              >
                {t('btn_retry')}
              </Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        )}
      </View>
    </Screen>
  );
}
