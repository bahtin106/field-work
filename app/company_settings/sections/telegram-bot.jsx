import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useNavigation } from 'expo-router';
import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';

import Screen from '../../../components/layout/Screen';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import IconButton from '../../../components/ui/IconButton';
import ThemedSwitch from '../../../components/ui/ThemedSwitch';
import SectionHeader from '../../../components/ui/SectionHeader';
import ExpandableTextRow from '../../../components/ui/ExpandableTextRow';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { ConfirmModal, SelectModal } from '../../../components/ui/modals';
import { useToast } from '../../../components/ui/ToastProvider';
import { telegramBotIntegration } from '../../../lib/telegramBotIntegration';
import { useAuthContext } from '../../../providers/SimpleAuthProvider';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

function fieldLabel(field) {
  return String(field?.label || field?.field_key || '').trim();
}

const LOCKED_FIELD_KEYS = new Set(['customer_name', 'phone', 'city', 'street', 'house']);
const CLIENT_FIELD_KEYS = new Set(['customer_name', 'phone', 'secondary_phone', 'email']);
const ADDRESS_FIELD_KEYS = new Set([
  'country',
  'region',
  'district',
  'city',
  'street',
  'house',
  'postal_code',
  'floor',
  'entrance',
  'apartment',
  'comment',
]);
const FIELD_SWITCH_COLUMN_WIDTH = 72;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function TelegramBotSettingsScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const nav = useNavigation();
  const { user: authUser, profile: authProfile } = useAuthContext();
  const s = React.useMemo(() => styles(theme), [theme]);
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const authUserId = String(authUser?.id || '');
  const authAccountType = String(authUser?.user_metadata?.account_type || '').toLowerCase();
  const isSoloAdmin =
    String(authProfile?.role || '').toLowerCase() === 'admin' && authAccountType === 'solo';

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [saveState, setSaveState] = React.useState('idle');
  const [data, setData] = React.useState(null);
  const [screenError, setScreenError] = React.useState('');
  const [assigneeModalVisible, setAssigneeModalVisible] = React.useState(false);
  const [regenerateConfirmVisible, setRegenerateConfirmVisible] = React.useState(false);
  const [clientFieldsExpanded, setClientFieldsExpanded] = React.useState(false);
  const [addressFieldsExpanded, setAddressFieldsExpanded] = React.useState(false);
  const [startLinkBusy, setStartLinkBusy] = React.useState(false);
  const dataRef = React.useRef(null);
  const confirmedDataRef = React.useRef(null);
  const lastSavedPayloadRef = React.useRef('');
  const lastFailedPayloadRef = React.useRef('');
  const saveStateTimeoutRef = React.useRef(null);
  const localVersionRef = React.useRef(0);

  React.useLayoutEffect(() => {
    nav?.setParams?.({ headerTitle: t('company_settings_telegram_title') });
  }, [nav, t]);

  const friendlyLoadError = React.useCallback((error) => {
    const message = String(error?.message || '').trim();
    if (!message) return t('company_settings_telegram_load_failed');
    return message;
  }, [t]);

  const load = React.useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setScreenError('');
    try {
      const next = await telegramBotIntegration('status');
      lastSavedPayloadRef.current = '';
      setData(next);
      dataRef.current = next;
      confirmedDataRef.current = next;
      localVersionRef.current = 0;
      lastSavedPayloadRef.current = JSON.stringify({
        config: next?.config || {},
        fields: (next?.fields || []).map((field, index) => ({
          field_key: field.field_key,
          is_enabled: field.is_enabled !== false,
          is_required: field.is_required === true,
          sort_order: index + 1,
        })),
      });
      lastFailedPayloadRef.current = '';
      setSaveState('idle');
      return next;
    } catch (error) {
      const message = friendlyLoadError(error);
      setScreenError(message);
      if (!silent) toast.error(message);
      throw error;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [friendlyLoadError, toast]);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        let next = null;
        let lastError = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            next = await telegramBotIntegration('status');
            break;
          } catch (error) {
            lastError = error;
            if (attempt < 2) await wait(500 * (attempt + 1));
          }
        }
        if (lastError && !next) throw lastError;
        if (!active) return;
        setScreenError('');
        setData(next);
        dataRef.current = next;
        confirmedDataRef.current = next;
        localVersionRef.current = 0;
        lastSavedPayloadRef.current = JSON.stringify({
          config: next?.config || {},
          fields: (next?.fields || []).map((field, index) => ({
            field_key: field.field_key,
            is_enabled: field.is_enabled !== false,
            is_required: field.is_required === true,
            sort_order: index + 1,
          })),
        });
        lastFailedPayloadRef.current = '';
        setSaveState('idle');
      } catch (error) {
        if (!active) return;
        const message = friendlyLoadError(error);
        setScreenError(message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [friendlyLoadError]);

  const assignees = React.useMemo(() => data?.assignees || [], [data?.assignees]);
  const config = React.useMemo(() => data?.config || {}, [data?.config]);
  const fields = React.useMemo(() => data?.fields || [], [data?.fields]);
  const showRoutingSection = config.is_enabled === true && !isSoloAdmin;
  const soloAssigneeId = React.useMemo(() => {
    if (!isSoloAdmin) return '';
    if (authUserId && assignees.some((item) => String(item?.id || '') === authUserId)) return authUserId;
    if (assignees.length === 1) return String(assignees[0]?.id || '');
    return '';
  }, [assignees, authUserId, isSoloAdmin]);
  const PREFERRED_FIELD_KEYS = React.useMemo(
    () => ['customer_name', 'phone', 'city', 'street', 'house'],
    [],
  );

  const orderedFields = React.useMemo(() => {
    if (!Array.isArray(fields) || fields.length === 0) return [];
    const prefIndex = new Map(PREFERRED_FIELD_KEYS.map((k, i) => [k, i]));
    return [...fields].sort((a, b) => {
      const ia = prefIndex.has(a.field_key) ? prefIndex.get(a.field_key) : -1;
      const ib = prefIndex.has(b.field_key) ? prefIndex.get(b.field_key) : -1;
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [fields, PREFERRED_FIELD_KEYS]);

  const topLevelFields = React.useMemo(
    () => orderedFields.filter((field) => {
      const fieldKey = String(field?.field_key || '');
      return !CLIENT_FIELD_KEYS.has(fieldKey) && !ADDRESS_FIELD_KEYS.has(fieldKey);
    }),
    [orderedFields],
  );

  const clientFields = React.useMemo(
    () => orderedFields.filter((field) => CLIENT_FIELD_KEYS.has(String(field?.field_key || ''))),
    [orderedFields],
  );

  const addressFields = React.useMemo(
    () => orderedFields.filter((field) => ADDRESS_FIELD_KEYS.has(String(field?.field_key || ''))),
    [orderedFields],
  );

  const setLocalData = React.useCallback((nextOrUpdater) => {
    localVersionRef.current += 1;
    setData((prev) => {
      const next =
        typeof nextOrUpdater === 'function'
          ? nextOrUpdater(prev)
          : nextOrUpdater;
      dataRef.current = next;
      return next;
    });
  }, []);

  const updateConfig = React.useCallback((patch) => {
    setLocalData((prev) => ({
      ...(prev || {}),
      config: {
        ...(prev?.config || {}),
        ...patch,
      },
    }));
  }, [setLocalData]);

  const updateField = React.useCallback((fieldKey, patch) => {
    setLocalData((prev) => ({
      ...(prev || {}),
      fields: (prev?.fields || []).map((field) =>
        field.field_key === fieldKey ? { ...field, ...patch } : field,
      ),
    }));
  }, [setLocalData]);

  const buildSavePayload = React.useCallback((snapshot) => ({
    config: snapshot?.config || {},
    fields: (snapshot?.fields || []).map((field, index) => ({
      field_key: field.field_key,
      is_enabled: field.is_enabled !== false,
      is_required: field.is_required === true,
      sort_order: index + 1,
    })),
  }), []);

  const serializePayload = React.useCallback(
    (snapshot) => JSON.stringify(buildSavePayload(snapshot)),
    [buildSavePayload],
  );

  const markSaved = React.useCallback(() => {
    setSaveState('saved');
    if (saveStateTimeoutRef.current) clearTimeout(saveStateTimeoutRef.current);
    saveStateTimeoutRef.current = setTimeout(() => {
      setSaveState('idle');
    }, 1800);
  }, []);

  const saveSnapshot = React.useCallback(async (
    snapshot,
    { showErrorToast = true, revertOnError = false, attemptVersion = localVersionRef.current } = {},
  ) => {
    setSaving(true);
    setSaveState('saving');
    try {
      const next = await telegramBotIntegration('save_config', buildSavePayload(snapshot));
      confirmedDataRef.current = next;
      lastSavedPayloadRef.current = serializePayload(next);
      lastFailedPayloadRef.current = '';
      if (localVersionRef.current === attemptVersion) {
        setData(next);
        dataRef.current = next;
        markSaved();
      }
      return next;
    } catch (error) {
      if (localVersionRef.current === attemptVersion) {
        setSaveState('error');
      }
      if (revertOnError && confirmedDataRef.current && localVersionRef.current === attemptVersion) {
        setData(confirmedDataRef.current);
        dataRef.current = confirmedDataRef.current;
      }
      if (showErrorToast) toast.error(error?.message || t('toast_error'));
      throw error;
    } finally {
      setSaving(false);
    }
  }, [buildSavePayload, markSaved, serializePayload, t, toast]);

  const toggleBotEnabled = React.useCallback(async (value) => {
    const previous = data;
    const nextSnapshot = {
      ...(data || {}),
      config: {
        ...(data?.config || {}),
        is_enabled: value,
      },
    };
    const attemptVersion = localVersionRef.current + 1;
    setLocalData(nextSnapshot);
    try {
      await saveSnapshot(nextSnapshot, {
        showErrorToast: true,
        revertOnError: true,
        attemptVersion,
      });
    } catch {
      if (localVersionRef.current === attemptVersion) {
        setData(previous);
        dataRef.current = previous;
      }
    }
  }, [data, saveSnapshot, setLocalData]);

  const handleRouteToFeedToggle = React.useCallback((value) => {
    if (value) {
      updateConfig({ destination_type: 'feed' });
      return;
    }

    if (config.destination_user_id) {
      updateConfig({ destination_type: 'assignee' });
      return;
    }

    setAssigneeModalVisible(true);
  }, [config.destination_user_id, updateConfig]);

  const handleAssigneeSelect = React.useCallback((assigneeId) => {
    if (!assigneeId || assigneeId === '__feed__') {
      updateConfig({ destination_type: 'feed' });
      setAssigneeModalVisible(false);
      return;
    }

    updateConfig({
      destination_type: 'assignee',
      destination_user_id: assigneeId,
    });
    setAssigneeModalVisible(false);
  }, [updateConfig]);

  const routingModalItems = React.useMemo(() => ([
    {
      id: '__feed__',
      label: t('company_settings_telegram_feed_selected'),
      onPress: () => handleAssigneeSelect('__feed__'),
    },
    ...assignees.map((item) => ({
      id: item.id,
      label: item.label,
      onPress: () => handleAssigneeSelect(item.id),
    })),
  ]), [assignees, handleAssigneeSelect, t]);

  const regenerateLink = React.useCallback(async () => {
    setStartLinkBusy(true);
    try {
      const next = await telegramBotIntegration('regenerate_token');
      setData((prev) => ({
        ...(prev || {}),
        start_link: next.start_link,
        config: {
          ...(prev?.config || {}),
          onboarding_token: next.onboarding_token,
        },
      }));
      toast.success(t('company_settings_telegram_link_regenerated'));
    } catch (error) {
      toast.error(error?.message || t('toast_error'));
    } finally {
      setStartLinkBusy(false);
    }
  }, [t, toast]);

  const confirmRegenerateLink = React.useCallback(() => {
    setRegenerateConfirmVisible(true);
  }, []);

  const copyStartLink = React.useCallback(async () => {
    if (!data?.start_link) return;
    await Clipboard.setStringAsync(String(data.start_link));
    toast.success(t('toast_copied'));
  }, [data?.start_link, t, toast]);

  const handleFieldToggle = React.useCallback((field, value) => {
    if (LOCKED_FIELD_KEYS.has(String(field?.field_key || ''))) {
      toast.info(t('company_settings_telegram_locked_field_toast'));
      return;
    }
    updateField(field.field_key, {
      is_enabled: value,
      is_required: value ? field.is_required === true : false,
    });
  }, [t, toast, updateField]);

  const handleFieldRequiredToggle = React.useCallback((field, value) => {
    if (LOCKED_FIELD_KEYS.has(String(field?.field_key || ''))) {
      toast.info(t('company_settings_telegram_locked_field_toast'));
      return;
    }
    updateField(field.field_key, {
      is_enabled: value ? true : field.is_enabled !== false,
      is_required: value === true,
    });
  }, [t, toast, updateField]);

  const saveStatusText = React.useMemo(() => {
    if (saveState === 'error') return t('company_settings_telegram_status_error');
    return '';
  }, [saveState, t]);

  const stickyHeaderIndices = React.useMemo(() => {
    if (config.is_enabled !== true) return undefined;
    return [screenError ? 5 : 4];
  }, [config.is_enabled, screenError]);

  const renderFieldRow = React.useCallback((field) => {
    const isLocked = LOCKED_FIELD_KEYS.has(String(field.field_key || ''));
    return (
      <Pressable
        key={field.field_key}
        onPress={() => {
          if (isLocked) {
            toast.info(t('company_settings_telegram_locked_field_toast'));
          }
        }}
        style={[
          base.row,
          s.fieldRow,
          field.is_enabled === false ? s.fieldRowDisabled : null,
          isLocked ? s.fieldRowLocked : null,
        ]}
      >
        <View style={s.fieldInfo}>
          <Text
            style={[
              base.label,
              s.fieldTitle,
              field.is_enabled === false ? s.fieldTitleDisabled : null,
            ]}
          >
            {fieldLabel(field)}
          </Text>
        </View>
        <View style={s.fieldControls}>
          <View style={[s.fieldSwitchCell, isLocked ? s.lockedControl : null]}>
            <ThemedSwitch
              value={isLocked ? true : field.is_enabled !== false}
              onValueChange={(value) => handleFieldToggle(field, value)}
              disabled={isLocked}
            />
          </View>
          <View style={[s.fieldSwitchCell, isLocked ? s.lockedControl : null]}>
            <ThemedSwitch
              value={isLocked ? true : field.is_required === true}
              onValueChange={(value) => handleFieldRequiredToggle(field, value)}
              disabled={isLocked}
            />
          </View>
        </View>
      </Pressable>
    );
  }, [base.label, base.row, handleFieldRequiredToggle, handleFieldToggle, s, t, toast]);

  React.useEffect(() => {
    dataRef.current = data;
  }, [data]);

  React.useEffect(() => {
    if (!isSoloAdmin) return;
    if (!data || !soloAssigneeId) return;
    const destinationType = String(data?.config?.destination_type || '');
    const destinationUserId = String(data?.config?.destination_user_id || '');
    if (destinationType === 'assignee' && destinationUserId === soloAssigneeId) return;
    updateConfig({
      destination_type: 'assignee',
      destination_user_id: soloAssigneeId,
    });
  }, [data, isSoloAdmin, soloAssigneeId, updateConfig]);

  React.useEffect(() => () => {
    if (saveStateTimeoutRef.current) clearTimeout(saveStateTimeoutRef.current);
  }, []);

  React.useEffect(() => {
    if (loading || !data || saving) return undefined;
    const payload = serializePayload(data);
    if (!payload || payload === lastSavedPayloadRef.current) return undefined;

    const timeoutId = setTimeout(async () => {
      const snapshot = dataRef.current;
      if (!snapshot) return;
      const currentPayload = serializePayload(snapshot);
      const attemptVersion = localVersionRef.current;
      if (!currentPayload || currentPayload === lastSavedPayloadRef.current) return;
      try {
        await saveSnapshot(snapshot, {
          showErrorToast: false,
          revertOnError: true,
          attemptVersion,
        });
      } catch {
        if (lastFailedPayloadRef.current !== currentPayload) {
          lastFailedPayloadRef.current = currentPayload;
          toast.error(t('company_settings_telegram_save_reverted'));
        }
      }
    }, 450);

    return () => clearTimeout(timeoutId);
  }, [data, loading, saveSnapshot, saving, serializePayload, t, toast]);

  if (loading) {
    return (
      <Screen background="background">
        <View style={s.loader}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen background="background" scroll={false}>
      <ScrollView contentContainerStyle={s.content} stickyHeaderIndices={stickyHeaderIndices}>
        {screenError ? (
          <Card style={s.errorCard}>
            <Text style={s.errorTitle}>{t('company_settings_telegram_load_failed')}</Text>
            <Text style={s.errorText}>{screenError}</Text>
            <Button title={t('common_refresh')} variant="secondary" onPress={() => load()} />
          </Card>
        ) : null}
        <Card paddedXOnly style={s.heroCard}>
          <View style={base.row}>
            <Text style={base.label}>{t('company_settings_telegram_enabled')}</Text>
            <ThemedSwitch
              value={config.is_enabled === true}
              onValueChange={toggleBotEnabled}
              disabled={saving}
            />
          </View>
          {saveStatusText ? (
            <>
              <View style={base.sep} />
              <View style={s.statusRow}>
                <Text
                  style={[
                    s.statusText,
                    saveState === 'error' ? s.statusTextError : null,
                  ]}
                >
                  {saveStatusText}
                </Text>
              </View>
            </>
          ) : null}
          {config.is_enabled === true ? (
            <>
              {!saveStatusText ? <View style={base.sep} /> : null}
              <View style={s.linkSection}>
              <View style={s.linkHeaderRow}>
                <View style={s.linkHeaderInline}>
                  <Text style={base.label}>{t('company_settings_telegram_link_label')}</Text>
                  <IconButton
                    onPress={confirmRegenerateLink}
                    accessibilityLabel={t('company_settings_telegram_regenerate_link')}
                    disabled={startLinkBusy}
                  >
                    <Feather
                      name="rotate-cw"
                      size={Number(theme?.typography?.sizes?.md ?? 16)}
                      color={startLinkBusy ? theme.colors.textSecondary : theme.colors.primary}
                    />
                  </IconButton>
                </View>
              </View>
              <View style={s.linkValueRow}>
                <Pressable
                  style={s.linkValuePressable}
                  onPress={copyStartLink}
                  accessibilityRole="link"
                  disabled={!data?.start_link}
                >
                  <Text
                      style={data?.start_link ? [base.value, s.link, s.linkValueText] : [base.value, s.linkPlaceholder, s.linkValueText]}
                    numberOfLines={3}
                  >
                    {data?.start_link || t('company_settings_telegram_link_unavailable')}
                  </Text>
                </Pressable>
                {data?.start_link ? (
                  <IconButton
                    style={{ display: 'none' }}
                    onPress={copyStartLink}
                    accessibilityLabel={t('company_settings_telegram_copy_link')}
                  >
                    <Feather name="copy" size={Number(theme?.typography?.sizes?.md ?? 16)} />
                  </IconButton>
                ) : null}
              </View>
              </View>
            </>
          ) : null}
        </Card>

        {showRoutingSection ? (
        <SectionHeader>
          {t('company_settings_telegram_routing_title')}
        </SectionHeader>
        ) : null}
        {showRoutingSection ? (
        <Card paddedXOnly style={s.sectionCard}>
          <View style={base.row}>
            <Text
              style={[
                base.label,
                config.destination_type === 'assignee' ? s.rowLabelMuted : null,
              ]}
            >
              {t('company_settings_telegram_route_to_feed')}
            </Text>
            <View style={s.routingControlWrap}>
              <ThemedSwitch
                value={config.destination_type !== 'assignee'}
                onValueChange={handleRouteToFeedToggle}
              />
            </View>
          </View>
          <View style={base.sep} />
          <Pressable
            style={base.row}
            onPress={() => setAssigneeModalVisible(true)}
            accessibilityRole="button"
          >
            <Text style={base.label}>
              {t('company_settings_telegram_assign_to_label')}
            </Text>
            <View style={s.routingValueWrap}>
              <View style={s.routingValueTextWrap}>
                <Text
                  style={[
                    base.value,
                    s.routingValue,
                    config.destination_type === 'assignee' ? null : s.routingValueDisabled,
                  ]}
                  numberOfLines={1}
                >
                  {config.destination_type === 'assignee'
                    ? assignees.find((item) => item.id === config.destination_user_id)?.label || t('common_select')
                    : t('company_settings_telegram_feed_selected')}
                </Text>
              </View>
              <View style={s.chevronButton}>
                <Feather
                  name="chevron-right"
                  size={Number(theme?.icons?.sm ?? 18)}
                  color={theme.colors.textSecondary}
                />
              </View>
            </View>
          </Pressable>
        </Card>
        ) : null}

        {config.is_enabled === true ? (
        <SectionHeader>
          {t('company_settings_telegram_fields_title')}
        </SectionHeader>
        ) : null}
        {config.is_enabled === true ? (
        <View style={s.stickyHeaderShell}>
          <Card paddedXOnly style={s.fieldHeaderCard}>
            <View style={[base.row, s.fieldHeaderRow]}>
              <View style={s.fieldInfo}>
                <Text style={s.fieldHeaderSpacer} />
              </View>
              <View style={s.fieldControls}>
                <Text style={s.fieldColumnTitle}>{t('company_settings_telegram_show_column')}</Text>
                <Text style={s.fieldColumnTitle}>{t('company_settings_telegram_required_column')}</Text>
              </View>
            </View>
            <View style={base.sep} />
          </Card>
        </View>
        ) : null}
        {config.is_enabled === true ? (
        <Card paddedXOnly style={s.fieldBodyCard}>
          {topLevelFields.map((field, index) => (
            <React.Fragment key={field.field_key}>
              {renderFieldRow(field)}
              {index < topLevelFields.length - 1 || clientFields.length > 0 || addressFields.length > 0 ? <View style={base.sep} /> : null}
            </React.Fragment>
          ))}
          {clientFields.length > 0 ? (
            <>
              <ExpandableTextRow
                label={t('routes_clients_client')}
                value=""
                forceShow
                initiallyExpanded={clientFieldsExpanded}
                rowPressDisabled
                toggleOnChevronOnly={false}
                onChevronPress={() => setClientFieldsExpanded((prev) => !prev)}
                onValuePress={() => setClientFieldsExpanded((prev) => !prev)}
                collapsedValue=""
                chevronName={clientFieldsExpanded ? 'chevron-up' : 'chevron-down'}
              />
              {clientFieldsExpanded ? (
                <View style={s.groupedFieldsWrap}>
                  <View style={base.sep} />
                  {clientFields.map((field, index) => (
                    <React.Fragment key={field.field_key}>
                      {renderFieldRow(field)}
                      {index < clientFields.length - 1 ? <View style={base.sep} /> : null}
                    </React.Fragment>
                  ))}
                </View>
              ) : null}
              {addressFields.length > 0 ? <View style={base.sep} /> : null}
            </>
          ) : null}
          {addressFields.length > 0 ? (
            <>
              <ExpandableTextRow
                label={t('objects_address_section')}
                value=""
                forceShow
                initiallyExpanded={addressFieldsExpanded}
                rowPressDisabled
                toggleOnChevronOnly={false}
                onChevronPress={() => setAddressFieldsExpanded((prev) => !prev)}
                onValuePress={() => setAddressFieldsExpanded((prev) => !prev)}
                collapsedValue=""
                chevronName={addressFieldsExpanded ? 'chevron-up' : 'chevron-down'}
              />
              {addressFieldsExpanded ? (
                <View style={s.groupedFieldsWrap}>
                  <View style={base.sep} />
                  {addressFields.map((field, index) => (
                    <React.Fragment key={field.field_key}>
                      {renderFieldRow(field)}
                      {index < addressFields.length - 1 ? <View style={base.sep} /> : null}
                    </React.Fragment>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </Card>
        ) : null}
      </ScrollView>

      {showRoutingSection ? (
        <SelectModal
          visible={assigneeModalVisible}
          title={t('company_settings_telegram_responsible_label')}
          items={routingModalItems}
          selectedId={config.destination_type === 'assignee' ? config.destination_user_id : '__feed__'}
          searchable
          onSelect={(item) => item?.onPress?.()}
          onClose={() => setAssigneeModalVisible(false)}
        />
      ) : null}
      <ConfirmModal
        visible={regenerateConfirmVisible}
        title={t('company_settings_telegram_regenerate_confirm_title')}
        message={t('company_settings_telegram_regenerate_confirm_message')}
        confirmLabel={t('company_settings_telegram_regenerate_confirm_action')}
        cancelLabel={t('btn_cancel')}
        loading={startLinkBusy}
        onConfirm={regenerateLink}
        onClose={() => setRegenerateConfirmVisible(false)}
      />
    </Screen>
  );
}

const styles = (theme) =>
  {
    const listItemPadX = theme.components?.listItem?.padX;
    const rowPaddingX =
      typeof listItemPadX === 'number'
        ? listItemPadX
        : theme.spacing?.[listItemPadX] ?? theme.spacing?.md ?? theme.spacing?.xs ?? 12;

    return StyleSheet.create({
    content: {
      padding: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
    },
    loader: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroCard: {
      borderRadius: theme.radii.lg,
    },
    sectionCard: {
      borderRadius: theme.radii.lg,
    },
    stickyHeaderShell: {
      backgroundColor: theme.colors.background,
      zIndex: 1,
    },
    fieldHeaderCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      borderBottomWidth: 0,
      shadowColor: 'transparent',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    fieldBodyCard: {
      borderRadius: theme.radii.lg,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      borderTopWidth: 0,
      shadowColor: 'transparent',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    routingControlWrap: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    routingValueWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: theme.spacing.xs,
      flexShrink: 1,
      minWidth: 0,
    },
    routingValueTextWrap: {
      flexShrink: 1,
      minWidth: 0,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    errorCard: {
      gap: theme.spacing.sm,
      borderRadius: theme.radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.danger,
    },
    heroTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.bold,
    },
    errorTitle: {
      color: theme.colors.danger,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.bold,
    },
    errorText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      lineHeight: 20,
    },
    rowLabelMuted: {
      color: theme.colors.textSecondary,
    },
    linkSection: {
      paddingVertical: theme.spacing.xs,
      paddingHorizontal: rowPaddingX,
      gap: theme.spacing.xs,
    },
    statusRow: {
      minHeight: theme.components?.listItem?.height ? Math.round(theme.components.listItem.height * 0.7) : 34,
      justifyContent: 'center',
    },
    statusText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: 20,
    },
    statusTextSaved: {
      color: theme.colors.success,
    },
    statusTextError: {
      color: theme.colors.danger,
    },
    linkHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
    },
    linkHeaderInline: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    linkValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    linkValuePressable: {
      flex: 1,
    },
    linkValueText: {
      textAlign: 'left',
    },
    link: {
      color: theme.colors.primary,
    },
    routingValue: {
      color: theme.colors.primary,
    },
    routingValueDisabled: {
      color: theme.colors.textSecondary,
    },
    linkPlaceholder: {
      color: theme.colors.textSecondary,
    },
    chevronButton: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    fieldRow: {
      gap: theme.spacing.md,
      paddingTop: 0,
      paddingBottom: 0,
    },
    fieldRowDisabled: {
      opacity: 0.45,
    },
    fieldRowLocked: {
      opacity: 1,
    },
    fieldHeaderRow: {
      gap: theme.spacing.md,
      paddingTop: 0,
      paddingBottom: 0,
    },
    fieldInfo: {
      flex: 1,
    },
    fieldHeaderSpacer: {
      minHeight: 1,
    },
    fieldTitle: {
      color: theme.colors.text,
    },
    fieldTitleDisabled: {
      color: theme.colors.textSecondary,
    },
    fieldColumnTitle: {
      width: FIELD_SWITCH_COLUMN_WIDTH,
      textAlign: 'center',
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: 20,
    },
    fieldControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      width: FIELD_SWITCH_COLUMN_WIDTH * 2 + theme.spacing.sm,
      justifyContent: 'space-between',
    },
    fieldSwitchCell: {
      width: FIELD_SWITCH_COLUMN_WIDTH,
      alignItems: 'center',
      justifyContent: 'center',
    },
    lockedControl: {
      opacity: 0.48,
    },
    groupedFieldsWrap: {
      paddingLeft: theme.spacing.lg,
    },
    });
  };
