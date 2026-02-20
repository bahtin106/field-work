import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import UIButton from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import TextField from '../../../components/ui/TextField';
import { useToast } from '../../../components/ui/ToastProvider';
import { yandexDiskIntegration } from '../../../lib/yandexDiskIntegration';
import { useAuthContext } from '../../../providers/SimpleAuthProvider';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const DEFAULT_FOLDER = '/apps/field-work';

export default function YandexDiskIntegrationScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { profile, isInitializing } = useAuthContext();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const toastRef = React.useRef(toast);
  const tRef = React.useRef(t);

  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState(null);
  const [folderPath, setFolderPath] = React.useState(DEFAULT_FOLDER);
  const [folderDraft, setFolderDraft] = React.useState(DEFAULT_FOLDER);
  const [provider, setProvider] = React.useState('app_storage');
  const processedOAuthRef = React.useRef('');

  React.useEffect(() => {
    toastRef.current = toast;
    tRef.current = t;
  }, [toast, t]);

  const canAccess = String(profile?.role || '').toLowerCase() === 'admin';
  const isExpoGo = Constants.appOwnership === 'expo';

  const refreshStatus = React.useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    try {
      const data = await yandexDiskIntegration('status');
      setStatus(data);
      const nextFolder = data?.account?.folder_path || DEFAULT_FOLDER;
      setFolderPath(nextFolder);
      setFolderDraft(nextFolder);
      setProvider(data?.media_provider || 'app_storage');
    } catch (e) {
      toastRef.current?.error?.(e?.message || tRef.current('toast_error'));
    } finally {
      setLoading(false);
    }
  }, [canAccess]);

  useFocusEffect(
    React.useCallback(() => {
      refreshStatus();
    }, [refreshStatus]),
  );

  React.useEffect(() => {
    if (isInitializing) return;
    if (!canAccess) {
      router.replace('/orders');
    }
  }, [isInitializing, canAccess, router]);

  React.useEffect(() => {
    const code = String(params?.code || '').trim();
    const state = String(params?.state || '').trim();
    if (!code || !state || !canAccess) return;
    const oauthKey = `${code}:${state}`;
    if (processedOAuthRef.current === oauthKey) return;
    processedOAuthRef.current = oauthKey;

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await yandexDiskIntegration('complete', { code, state });
        if (cancelled) return;
        toast.success(t('company_integrations_yandex_connected'));
        await refreshStatus();
      } catch (e) {
        if (cancelled) return;
        toast.error(e?.message || t('toast_error'));
      } finally {
        if (!cancelled) setLoading(false);
        router.replace('/company_settings/sections/yandex-disk');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params, canAccess, refreshStatus, router, t, toast]);

  const startConnect = React.useCallback(async () => {
    if (isExpoGo) {
      toast.error(
        'В Expo Go OAuth возврат не поддерживается. Используйте dev build / apk / testflight.',
      );
      return;
    }
    setLoading(true);
    try {
      const data = await yandexDiskIntegration('start');
      const url = String(data?.auth_url || '');
      if (!url) throw new Error(t('toast_error'));
      await Linking.openURL(url);
    } catch (e) {
      toast.error(e?.message || t('toast_error'));
    } finally {
      setLoading(false);
    }
  }, [isExpoGo, t, toast]);

  const disconnect = React.useCallback(async () => {
    setLoading(true);
    try {
      await yandexDiskIntegration('disconnect');
      toast.success(t('company_integrations_yandex_disconnected'));
      await refreshStatus();
    } catch (e) {
      toast.error(e?.message || t('toast_error'));
    } finally {
      setLoading(false);
    }
  }, [refreshStatus, t, toast]);

  const saveFolder = React.useCallback(async () => {
    setLoading(true);
    try {
      const normalized = String(folderDraft || '').trim() || DEFAULT_FOLDER;
      const data = await yandexDiskIntegration('set_folder', { folder_path: normalized });
      setFolderPath(data?.folder_path || normalized);
      setFolderDraft(data?.folder_path || normalized);
      toast.success(t('toast_settingsSaved'));
    } catch (e) {
      toast.error(e?.message || t('toast_error'));
    } finally {
      setLoading(false);
    }
  }, [folderDraft, t, toast]);

  const chooseProvider = React.useCallback(
    async (nextProvider) => {
      if (nextProvider === provider) return;
      setLoading(true);
      try {
        await yandexDiskIntegration('set_provider', { provider: nextProvider });
        setProvider(nextProvider);
        toast.success(t('toast_settingsSaved'));
      } catch (e) {
        toast.error(e?.message || t('toast_error'));
      } finally {
        setLoading(false);
      }
    },
    [provider, t, toast],
  );

  if (isInitializing || !canAccess) return null;

  const connected = Boolean(status?.connected);
  const yandexName =
    status?.account?.display_name ||
    status?.account?.login ||
    t('company_integrations_yandex_account_unknown');

  return (
    <Screen
      background="background"
      headerOptions={{ title: t('settings_integrations_yandex_disk') }}
    >
      <View style={styles.container}>
        <Card>
          <Text style={styles.sectionTitle}>{t('company_integrations_storage_provider_title')}</Text>
          <View style={styles.providerRow}>
            <Pressable
              onPress={() => chooseProvider('app_storage')}
              style={[
                styles.providerButton,
                provider === 'app_storage' ? styles.providerButtonActive : null,
              ]}
            >
              <Text style={styles.providerText}>{t('company_integrations_storage_provider_app')}</Text>
            </Pressable>
            <Pressable
              onPress={() => chooseProvider('yandex_disk')}
              style={[
                styles.providerButton,
                provider === 'yandex_disk' ? styles.providerButtonActive : null,
              ]}
            >
              <Text style={styles.providerText}>{t('company_integrations_storage_provider_yandex')}</Text>
            </Pressable>
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>{t('settings_integrations_yandex_disk')}</Text>
          <Text style={styles.statusText}>
            {connected
              ? t('company_integrations_yandex_status_connected').replace('{name}', yandexName)
              : t('company_integrations_yandex_status_not_connected')}
          </Text>

          {connected ? (
            <>
              <TextField
                label={t('company_integrations_yandex_folder')}
                value={folderDraft}
                onChangeText={setFolderDraft}
                placeholder={DEFAULT_FOLDER}
              />
              <View style={styles.rowActions}>
                <UIButton
                  title={t('btn_save')}
                  onPress={saveFolder}
                  disabled={loading || folderDraft === folderPath}
                />
                <UIButton
                  title={t('company_integrations_disconnect')}
                  variant="destructive"
                  onPress={disconnect}
                  disabled={loading}
                />
              </View>
            </>
          ) : (
            <UIButton
              title={t('company_integrations_connect')}
              onPress={startConnect}
              disabled={loading}
            />
          )}
          {isExpoGo ? (
            <Text style={styles.hintText}>
              OAuth-подключение в Expo Go не завершается callback-ссылкой. Для теста нужен dev build.
            </Text>
          ) : null}
        </Card>
      </View>
    </Screen>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    container: {
      gap: theme.spacing.md,
      paddingBottom: theme.spacing.xl,
    },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
      marginBottom: theme.spacing.sm,
    },
    statusText: {
      color: theme.colors.textSecondary,
      marginBottom: theme.spacing.md,
    },
    hintText: {
      color: theme.colors.textSecondary,
      marginTop: theme.spacing.sm,
      fontSize: theme.typography.sizes.sm,
    },
    providerRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    providerButton: {
      flex: 1,
      borderRadius: theme.radii.md,
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.border,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
    },
    providerButtonActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.ripple,
    },
    providerText: {
      color: theme.colors.text,
      fontWeight: theme.typography.weight.medium,
    },
    rowActions: {
      marginTop: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
  });
}
