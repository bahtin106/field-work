import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';
import Screen from './Screen';

export default function LazyRouteScreen({
  load,
  titleKey,
  titleFallback,
  screenProps,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [LoadedScreen, setLoadedScreen] = React.useState(null);
  const [loadError, setLoadError] = React.useState(false);
  const loadRef = React.useRef(load);
  const retryNonceRef = React.useRef(0);
  const title = titleKey ? t(titleKey, titleFallback || titleKey) : titleFallback || t('toast_loading_info', 'Loading...');

  React.useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const startLoad = React.useCallback(() => {
    setLoadError(false);
    const nonce = retryNonceRef.current + 1;
    retryNonceRef.current = nonce;
    return loadRef.current()
      .then((mod) => {
        if (retryNonceRef.current !== nonce) return;
        setLoadedScreen(() => mod.default || mod);
      })
      .catch(() => {
        if (retryNonceRef.current === nonce) setLoadError(true);
      });
  }, []);

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
              {t('refresh_failed', 'Не удалось обновить данные')}
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
                {t('btn_retry', 'Повторить')}
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
