import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import Screen from '../../../components/layout/Screen';
import UIButton from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import LabelValueRow from '../../../components/ui/LabelValueRow';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField, { SelectField } from '../../../components/ui/TextField';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { BaseModal, SelectModal } from '../../../components/ui/modals';
import { useToast } from '../../../components/ui/ToastProvider';
import { COMPANY_SETTINGS_QUERY_KEY } from '../../../lib/companySettingsQuery';
import { yandexDiskIntegration } from '../../../lib/yandexDiskIntegration';
import { useAuthContext } from '../../../providers/SimpleAuthProvider';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const DEFAULT_FOLDER = '/\u041c\u043e\u043d\u0438\u0442\u043e\u0440';

function toYandexIntegrationMessage(rawError, t) {
  const fallback = t('toast_error');
  const message = String(rawError?.message || rawError || '').trim();
  if (!message) return fallback;

  const normalized = message.toLowerCase();
  if (normalized.includes('unknown action')) {
    return t('company_integrations_server_update_required');
  }
  if (normalized.includes('missing yandex oauth client id')) {
    return t('company_integrations_yandex_error_missing_client_id');
  }
  if (normalized.includes('missing yandex oauth credentials')) {
    return t('company_integrations_yandex_error_missing_credentials');
  }
  if (normalized.includes('yandex disk not connected')) {
    return t('company_integrations_yandex_error_not_connected');
  }
  if (normalized.includes('profile not found') || normalized.includes('forbidden')) {
    return t('company_integrations_yandex_error_access_denied');
  }
  if (normalized.includes('state expired') || normalized.includes('invalid state')) {
    return t('company_integrations_yandex_error_oauth_expired');
  }
  if (
    normalized.includes('diskfull') ||
    normalized.includes('quota') ||
    normalized.includes('insufficient storage') ||
    normalized.includes('no space left')
  ) {
    return t('company_integrations_yandex_error_quota_exceeded');
  }
  if (
    normalized.includes('token refresh failed') ||
    normalized.includes('unauthorized') ||
    normalized.includes('invalid_grant')
  ) {
    return t('company_integrations_yandex_error_reconnect_required');
  }

  return message;
}

function formatStorageAmount(bytes, t) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return t('company_integrations_yandex_space_unknown');
  if (value === 0) return `0 ${t('company_integrations_yandex_unit_mb')}`;
  const mb = value / (1024 * 1024);
  if (mb < 1024) {
    const prettyMb = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(mb);
    return `${prettyMb} ${t('company_integrations_yandex_unit_mb')}`;
  }
  const gb = mb / 1024;
  const prettyGb = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(gb);
  return `${prettyGb} ${t('company_integrations_yandex_unit_gb')}`;
}

export default function YandexDiskIntegrationScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams();
  const { profile, isInitializing } = useAuthContext();
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const toastRef = React.useRef(toast);
  const tRef = React.useRef(t);

  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState(null);
  const [folderPath, setFolderPath] = React.useState(DEFAULT_FOLDER);
  const [folderDraft, setFolderDraft] = React.useState(DEFAULT_FOLDER);
  const [provider, setProvider] = React.useState('beget_s3');
  const [profileProvider, setProfileProvider] = React.useState('beget_s3');
  const [providerModalVisible, setProviderModalVisible] = React.useState(false);
  const [providerTarget, setProviderTarget] = React.useState('orders');
  const [folderModalVisible, setFolderModalVisible] = React.useState(false);
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
      const raw = await yandexDiskIntegration('status');
      const payload = raw && typeof raw?.data === 'object' && raw?.data !== null ? raw.data : raw;
      setStatus(payload);
      const nextFolder =
        payload?.account?.folder_path ||
        payload?.folder_path ||
        DEFAULT_FOLDER;
      setFolderPath(nextFolder);
      setFolderDraft(nextFolder);
      setProvider(payload?.media_provider || payload?.provider || 'beget_s3');
      setProfileProvider(payload?.profile_media_provider || 'beget_s3');
      await queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY });
    } catch (e) {
      toastRef.current?.error?.(toYandexIntegrationMessage(e, tRef.current));
    } finally {
      setLoading(false);
    }
  }, [canAccess, queryClient]);

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
        toast.error(toYandexIntegrationMessage(e, t));
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
      toast.error(t('company_integrations_yandex_expo_go_warning'));
      return;
    }
    setLoading(true);
    try {
      const data = await yandexDiskIntegration('start');
      const url = String(data?.auth_url || '');
      if (!url) throw new Error(t('toast_error'));
      await Linking.openURL(url);
    } catch (e) {
      toast.error(toYandexIntegrationMessage(e, t));
    } finally {
      setLoading(false);
    }
  }, [isExpoGo, t, toast]);

  const disconnect = React.useCallback(async () => {
    setLoading(true);
    try {
      await yandexDiskIntegration('disconnect');
      toast.success(t('company_integrations_yandex_disconnected'));
      toast.info(t('company_integrations_yandex_disconnect_info'));
      await refreshStatus();
      await queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY });
    } catch (e) {
      toast.error(toYandexIntegrationMessage(e, t));
    } finally {
      setLoading(false);
    }
  }, [queryClient, refreshStatus, t, toast]);

  const saveFolder = React.useCallback(async () => {
    setLoading(true);
    try {
      const normalized = String(folderDraft || '').trim() || DEFAULT_FOLDER;
      const data = await yandexDiskIntegration('set_folder', { folder_path: normalized });
      setFolderPath(data?.folder_path || normalized);
      setFolderDraft(data?.folder_path || normalized);
      toast.success(t('toast_settingsSaved'));
      setFolderModalVisible(false);
    } catch (e) {
      toast.error(toYandexIntegrationMessage(e, t));
    } finally {
      setLoading(false);
    }
  }, [folderDraft, t, toast]);

  const chooseProvider = React.useCallback(
    async (target, nextProvider) => {
      const currentProvider = target === 'profiles' ? profileProvider : provider;
      if (nextProvider === currentProvider) return;
      if (nextProvider === 'yandex_disk' && !status?.connected) {
        toast.info(t('company_integrations_yandex_connect_first'));
        return;
      }
      setLoading(true);
      try {
        const action = target === 'profiles' ? 'set_profile_provider' : 'set_provider';
        await yandexDiskIntegration(action, { provider: nextProvider });
        if (target === 'profiles') setProfileProvider(nextProvider);
        else setProvider(nextProvider);
        await queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY });
        toast.success(t('toast_settingsSaved'));
      } catch (e) {
        toast.error(toYandexIntegrationMessage(e, t));
      } finally {
        setLoading(false);
      }
    },
    [profileProvider, provider, queryClient, status?.connected, t, toast],
  );

  if (isInitializing || !canAccess) return null;

  const connected = Boolean(
    status?.connected ||
    status?.is_connected ||
    status?.account ||
    status?.yandex_login ||
    status?.yandex_display_name,
  );
  const providerLabel =
    provider === 'yandex_disk'
      ? t('company_integrations_storage_provider_yandex')
      : t('company_integrations_storage_provider_app');
  const profileProviderLabel =
    profileProvider === 'yandex_disk'
      ? t('company_integrations_storage_provider_yandex')
      : t('company_integrations_storage_provider_app');
  const yandexName =
    status?.account?.display_name ||
    status?.account?.login ||
    status?.yandex_display_name ||
    status?.yandex_login ||
    t('company_integrations_yandex_account_unknown');
  const normalizedStorage = (() => {
    const storageSource =
      status?.storage ||
      status?.disk_storage ||
      status?.disk ||
      status?.quota ||
      status?.account?.storage ||
      {};
    const free = Number(
      storageSource?.free_bytes ??
      storageSource?.freeBytes ??
      storageSource?.free_space ??
      storageSource?.free,
    );
    const used = Number(
      storageSource?.used_bytes ??
      storageSource?.usedBytes ??
      storageSource?.used_space ??
      storageSource?.used,
    );
    const total = Number(
      storageSource?.total_bytes ??
      storageSource?.totalBytes ??
      storageSource?.total_space ??
      storageSource?.total,
    );
    if (Number.isFinite(total) && total > 0) {
      const safeUsed = Number.isFinite(used) ? used : Math.max(total - (Number.isFinite(free) ? free : 0), 0);
      const safeFree = Number.isFinite(free) ? free : Math.max(total - safeUsed, 0);
      return {
        free_bytes: safeFree,
        used_bytes: safeUsed,
        total_bytes: total,
      };
    }
    return null;
  })();
  const health = (() => {
    const raw = String(
      status?.health ||
      status?.connection_health ||
      status?.state ||
      '',
    ).trim().toLowerCase();
    if (raw) return raw;
    if (!connected) return 'not_connected';
    if (normalizedStorage && normalizedStorage.free_bytes <= 0) return 'quota_exceeded';
    if (normalizedStorage) return 'ok';
    return 'unknown';
  })();
  const healthLabel = t(
    `company_integrations_yandex_health_${health}`,
    t('company_integrations_yandex_health_unknown'),
  );
  const usedSpaceText = formatStorageAmount(normalizedStorage?.used_bytes, t);
  const totalSpaceText = formatStorageAmount(normalizedStorage?.total_bytes, t);
  const showTotal = totalSpaceText !== t('company_integrations_yandex_space_unknown');
  const usedSpaceValue = showTotal ? `${usedSpaceText} / ${totalSpaceText}` : usedSpaceText;
  const usedPercent = (() => {
    const used = Number(normalizedStorage?.used_bytes);
    const total = Number(normalizedStorage?.total_bytes);
    if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
    return (used / total) * 100;
  })();
  const statusColor = (() => {
    const success = theme.colors.success || '#2e7d32';
    const warning = theme.colors.warning || '#f57c00';
    const danger = theme.colors.danger || '#d32f2f';
    if (health === 'ok') return success;
    if (health === 'quota_exceeded' || health === 'reconnect_required' || health === 'error') {
      return warning;
    }
    return danger;
  })();
  const usedSpaceColor = (() => {
    const success = theme.colors.success || '#2e7d32';
    const warning = theme.colors.warning || '#f57c00';
    const danger = theme.colors.danger || '#d32f2f';
    if (!normalizedStorage) return danger;
    if (Number(normalizedStorage?.free_bytes) <= 0) return danger;
    if (usedPercent != null && usedPercent > 90) return warning;
    return success;
  })();
  const isGoogleConnected = false;

  const separatorInsetKey =
    theme.components?.input?.separator?.insetX ||
    theme.components?.card?.padX ||
    'lg';
  const separatorInset = theme.spacing?.[separatorInsetKey] ?? theme.spacing.lg;
  return (
    <Screen
      background="background"
      headerOptions={{ title: t('settings_integrations_yandex_disk') }}
    >
      <ScrollView contentContainerStyle={styles.container} style={styles.scroll} keyboardShouldPersistTaps="handled">
        <SectionHeader>{t('company_integrations_storage_provider_title')}</SectionHeader>
        <Card padded={false}>
          <SelectField
            label={t('company_integrations_media_orders_label')}
            value={providerLabel}
            onPress={() => {
              setProviderTarget('orders');
              setProviderModalVisible(true);
            }}
            disabled={loading}
            style={{ paddingHorizontal: separatorInset }}
          />
          <View style={[styles.separator, { marginHorizontal: separatorInset }]} />
          <LabelValueRow
            label={t('company_integrations_profile_photos_label')}
            value={profileProviderLabel}
            style={[styles.infoRow, styles.disabledStorageRow, { paddingHorizontal: separatorInset }]}
          />
        </Card>

        <SectionHeader>{t('company_integrations_yandex_section_title')}</SectionHeader>
        <Card padded={false}>
          {connected ? (
            <>
              <LabelValueRow
                label={t('company_integrations_yandex_account_label')}
                value={yandexName}
                style={[styles.infoRow, { paddingHorizontal: separatorInset }]}
              />
              <View style={[styles.separator, { marginHorizontal: separatorInset }]} />
              <LabelValueRow
                label={t('company_integrations_yandex_health_prefix')}
                valueComponent={<Text style={[base.value, { color: statusColor }]}>{healthLabel}</Text>}
                style={[styles.infoRow, { paddingHorizontal: separatorInset }]}
              />
              <View style={[styles.separator, { marginHorizontal: separatorInset }]} />
              <LabelValueRow
                label={t('company_integrations_yandex_used_space_prefix')}
                valueComponent={<Text style={[base.value, { color: usedSpaceColor }]}>{usedSpaceValue}</Text>}
                style={[styles.infoRow, { paddingHorizontal: separatorInset }]}
              />
              <View style={[styles.separator, { marginHorizontal: separatorInset }]} />
              <SelectField
                label={t('company_integrations_yandex_folder')}
                value={folderPath || DEFAULT_FOLDER}
                onPress={() => setFolderModalVisible(true)}
                disabled={loading}
                style={{ paddingHorizontal: separatorInset }}
              />
              <View style={styles.actionsWrap}>
                <UIButton
                  title={t('company_integrations_disconnect')}
                  variant="destructive"
                  onPress={disconnect}
                  disabled={loading}
                />
                {isExpoGo ? (
                  <Text style={styles.hintText}>{t('company_integrations_yandex_expo_go_hint')}</Text>
                ) : null}
              </View>
            </>
          ) : (
            <View style={styles.actionsWrap}>
              <UIButton
                title={t('company_integrations_connect')}
                onPress={startConnect}
                disabled={loading}
              />
              {isExpoGo ? (
                <Text style={styles.hintText}>{t('company_integrations_yandex_expo_go_hint')}</Text>
              ) : null}
            </View>
          )}
        </Card>

        <SectionHeader>{t('company_integrations_google_section_title')}</SectionHeader>
        <Card padded={false}>
          {isGoogleConnected ? (
            <>
              <LabelValueRow
                label={t('company_integrations_google_account_label')}
                value={t('company_integrations_google_account_unknown')}
                style={[styles.infoRow, { paddingHorizontal: separatorInset }]}
              />
              <View style={[styles.separator, { marginHorizontal: separatorInset }]} />
              <LabelValueRow
                label={t('company_integrations_google_health_label')}
                value={t('company_integrations_google_health_unknown')}
                style={[styles.infoRow, { paddingHorizontal: separatorInset }]}
              />
            </>
          ) : (
            <View style={styles.actionsWrap}>
              <UIButton
                title={t('company_integrations_google_connect')}
                variant="secondary"
                style={styles.disabledActionButton}
                onPress={() => toast.info(t('company_integrations_google_disabled_toast'))}
              />
            </View>
          )}
        </Card>

        <SectionHeader>{t('company_integrations_yandex_rules_title')}</SectionHeader>
        <Card padded={false}>
          <View style={[base.row, styles.ruleRow, { paddingHorizontal: separatorInset }]}>
            <Text style={styles.ruleItem}>{t('company_integrations_yandex_rule_disconnect')}</Text>
          </View>
          <View style={[styles.separator, { marginHorizontal: separatorInset }]} />
          <View style={[base.row, styles.ruleRow, { paddingHorizontal: separatorInset }]}>
            <Text style={styles.ruleItem}>{t('company_integrations_yandex_rule_quota')}</Text>
          </View>
          <View style={[styles.separator, { marginHorizontal: separatorInset }]} />
          <View style={[base.row, styles.ruleRow, { paddingHorizontal: separatorInset }]}>
            <Text style={styles.ruleItem}>{t('company_integrations_yandex_rule_deleted_remote')}</Text>
          </View>
        </Card>
      </ScrollView>

      <SelectModal
        visible={providerModalVisible}
        onClose={() => setProviderModalVisible(false)}
        title={
          providerTarget === 'profiles'
            ? t('company_integrations_profile_storage_provider_modal_title')
            : t('company_integrations_storage_provider_modal_title')
        }
        searchable={false}
        selectedId={providerTarget === 'profiles' ? profileProvider : provider}
        items={[
          { id: 'beget_s3', label: t('company_integrations_storage_provider_app') },
          { id: 'yandex_disk', label: t('company_integrations_storage_provider_yandex') },
        ]}
        onSelect={(item) => {
          setProviderModalVisible(false);
          chooseProvider(providerTarget, String(item?.id || 'beget_s3'));
        }}
      />

      <BaseModal
        visible={folderModalVisible}
        onClose={() => {
          setFolderDraft(folderPath || DEFAULT_FOLDER);
          setFolderModalVisible(false);
        }}
        title={t('company_integrations_yandex_folder')}
        footer={
          <View style={styles.modalFooter}>
            <View style={styles.modalButtonWrap}>
              <UIButton
                title={t('btn_cancel')}
                variant="secondary"
                onPress={() => {
                  setFolderDraft(folderPath || DEFAULT_FOLDER);
                  setFolderModalVisible(false);
                }}
              />
            </View>
            <View style={styles.modalButtonWrap}>
              <UIButton
                title={t('btn_save')}
                onPress={saveFolder}
                disabled={loading || String(folderDraft || '').trim() === String(folderPath || '').trim()}
                loading={loading}
              />
            </View>
          </View>
        }
      >
        <TextField
          label={t('company_integrations_yandex_folder')}
          value={folderDraft}
          onChangeText={setFolderDraft}
          placeholder={DEFAULT_FOLDER}
          editable={!loading}
          returnKeyType="done"
          onSubmitEditing={saveFolder}
        />
        <Text style={styles.hintText}>{t('company_integrations_yandex_folder_hint')}</Text>
      </BaseModal>
    </Screen>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    scroll: {
      flex: 1,
    },
    container: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.xs,
      paddingBottom: theme.spacing.xl,
    },
    separator: {
      height: theme.components?.listItem?.dividerWidth || 1,
      backgroundColor: theme.colors.border,
    },
    infoRow: {
      minHeight: theme.components?.listItem?.height ?? 48,
    },
    disabledStorageRow: {
      opacity: 0.65,
    },
    actionsWrap: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    disabledActionButton: {
      opacity: 0.65,
    },
    hintText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round((theme.typography.sizes.sm || 14) * (theme.typography.lineHeights?.normal || 1.3)),
    },
    ruleRow: {
      minHeight: theme.components?.listItem?.height ?? 48,
      alignItems: 'flex-start',
      paddingTop: theme.spacing.sm,
      paddingBottom: theme.spacing.sm,
    },
    ruleItem: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      flexShrink: 1,
      lineHeight: Math.round((theme.typography.sizes.sm || 14) * (theme.typography.lineHeights?.normal || 1.3)),
    },
    modalFooter: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    modalButtonWrap: {
      flex: 1,
    },
  });
}
