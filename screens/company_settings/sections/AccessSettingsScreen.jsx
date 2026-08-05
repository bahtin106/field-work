import React from 'react';
// Heavy implementation is loaded by a lightweight Expo Router wrapper.
import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import SeparatedList from '../../../components/ui/SeparatedList';
import SectionHeader from '../../../components/ui/SectionHeader';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import ThemedSwitch from '../../../components/ui/ThemedSwitch';
import { useToast } from '../../../components/ui/ToastProvider';
import {
  KeyboardAwareScrollView,
  SMOOTH_KEYBOARD_DISMISS_MODE,
} from '../../../lib/keyboardControllerCompat';
import {
  CONFIGURABLE_PERMISSION_KEYS,
  START_PRESET,
  usePermissions,
} from '../../../lib/permissions';
import { supabase } from '../../../lib/supabase';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const ROLE_IDS = ['admin', 'dispatcher', 'worker'];
const EDITABLE_ROLE_IDS = ['dispatcher', 'worker'];
const ACCESS_SECTIONS = [
  {
    id: 'requests',
    titleKey: 'access_settings_section_requests',
    descriptionKey: 'access_settings_section_requests_description',
    permissions: [
      { key: 'canCreateOrders', labelKey: 'access_settings_perm_create_orders' },
      { key: 'canEditOrders', labelKey: 'access_settings_perm_edit_orders' },
      { key: 'canCompleteOwnOrders', labelKey: 'access_settings_perm_complete_own_orders' },
      { key: 'canCompleteOtherOrders', labelKey: 'access_settings_perm_complete_other_orders' },
      { key: 'canAssignExecutors', labelKey: 'access_settings_perm_assign_executors' },
      { key: 'canViewAllOrders', labelKey: 'access_settings_perm_view_all_orders' },
      { key: 'canDeleteOrders', labelKey: 'access_settings_perm_delete_orders' },
    ],
  },
  {
    id: 'request_content',
    titleKey: 'access_settings_section_request_content',
    descriptionKey: 'access_settings_section_request_content_description',
    permissions: [
      { key: 'canViewOrderPhotos', labelKey: 'access_settings_perm_view_order_photos' },
      { key: 'canAddGalleryPhotos', labelKey: 'access_settings_perm_add_gallery_photos' },
      { key: 'canAddCameraPhotos', labelKey: 'access_settings_perm_add_camera_photos' },
      { key: 'canViewOrderHistory', labelKey: 'access_settings_perm_view_order_history' },
    ],
  },
  {
    id: 'finances',
    titleKey: 'access_settings_section_finances',
    descriptionKey: 'access_settings_section_finances_description',
    permissions: [
      { key: 'canViewOrderAmount', labelKey: 'access_settings_perm_view_order_amount' },
      { key: 'canEditOrderAmount', labelKey: 'access_settings_perm_edit_order_amount' },
      { key: 'canViewFinanceOwn', labelKey: 'access_settings_perm_view_finance_own' },
      { key: 'canViewFinanceAll', labelKey: 'access_settings_perm_view_finance_all' },
      { key: 'canEditFinanceEntries', labelKey: 'access_settings_perm_edit_finance_entries' },
      { key: 'canManageFinanceRules', labelKey: 'access_settings_perm_manage_finance_rules' },
      { key: 'canViewFinanceStatsAll', labelKey: 'access_settings_perm_view_finance_stats' },
    ],
  },
  {
    id: 'clients',
    titleKey: 'access_settings_section_clients',
    descriptionKey: 'access_settings_section_clients_description',
    permissions: [
      { key: 'canViewClients', labelKey: 'access_settings_perm_view_clients' },
      { key: 'canViewClientPhones', labelKey: 'access_settings_perm_view_client_phones' },
      { key: 'canCreateClients', labelKey: 'access_settings_perm_create_clients' },
      { key: 'canEditClients', labelKey: 'access_settings_perm_edit_clients' },
      { key: 'canDeleteClients', labelKey: 'access_settings_perm_delete_clients' },
    ],
  },
  {
    id: 'objects',
    titleKey: 'access_settings_section_objects',
    descriptionKey: 'access_settings_section_objects_description',
    permissions: [
      { key: 'canViewObjects', labelKey: 'access_settings_perm_view_objects' },
      { key: 'canViewObjectPhones', labelKey: 'access_settings_perm_view_object_phones' },
      { key: 'canCreateObjects', labelKey: 'access_settings_perm_create_objects' },
      { key: 'canEditObjects', labelKey: 'access_settings_perm_edit_objects' },
      { key: 'canDeleteObjects', labelKey: 'access_settings_perm_delete_objects' },
    ],
  },
  {
    id: 'trash',
    titleKey: 'access_settings_section_trash',
    descriptionKey: 'access_settings_section_trash_description',
    permissions: [
      { key: 'canViewTrash', labelKey: 'access_settings_perm_view_trash' },
      { key: 'canRestoreTrash', labelKey: 'access_settings_perm_restore_trash' },
      { key: 'canPurgeTrash', labelKey: 'access_settings_perm_purge_trash' },
    ],
  },
];
const ROLE_LABEL_KEYS = {
  admin: 'role_admin',
  dispatcher: 'role_dispatcher',
  worker: 'role_worker',
};
const BROADCAST_CHANNEL = 'permissions';
const BROADCAST_EVENT = 'perm_changed';
const BROADCAST_CLEANUP_DELAY_MS = 250;

const PERSISTED_PERMISSION_KEYS = Array.from(new Set(CONFIGURABLE_PERMISSION_KEYS));

const createDefaultMatrix = () =>
  ROLE_IDS.reduce((acc, roleId) => {
    const roleDefaults = START_PRESET?.[roleId] || {};
    acc[roleId] = PERSISTED_PERMISSION_KEYS.reduce((roleAcc, permissionKey) => {
      roleAcc[permissionKey] = !!roleDefaults[permissionKey];
      return roleAcc;
    }, {});
    return acc;
  }, {});

const toBool = (value) =>
  value === true || value === 1 || value === '1' || value === 'true' || value === 't';

const mergeWithDefaults = (data) => {
  const merged = createDefaultMatrix();
  for (const roleId of ROLE_IDS) {
    merged[roleId] = { ...merged[roleId], ...(data?.[roleId] || {}) };
  }
  return merged;
};

const REQUIRES_PERMISSION = {
  canCompleteOtherOrders: 'canViewAllOrders',
  canAddGalleryPhotos: 'canViewOrderPhotos',
  canAddCameraPhotos: 'canViewOrderPhotos',
  canEditOrderAmount: 'canViewOrderAmount',
  canViewFinanceAll: 'canViewFinanceOwn',
  canEditFinanceEntries: 'canViewFinanceAll',
  canManageFinanceRules: 'canViewFinanceAll',
  canViewFinanceStatsAll: 'canViewFinanceAll',
  canViewClientPhones: 'canViewClients',
  canCreateClients: 'canViewClients',
  canEditClients: 'canViewClients',
  canDeleteClients: 'canViewClients',
  canViewObjectPhones: 'canViewObjects',
  canCreateObjects: 'canViewObjects',
  canEditObjects: 'canViewObjects',
  canDeleteObjects: 'canViewObjects',
  canRestoreTrash: 'canViewTrash',
  canPurgeTrash: 'canViewTrash',
};

const normalizeRoleDependencies = (roleId, source) => {
  const rolePerms = { ...(source || {}) };
  if (roleId === 'admin') {
    for (const permissionKey of PERSISTED_PERMISSION_KEYS) rolePerms[permissionKey] = true;
    return rolePerms;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [permissionKey, requiredKey] of Object.entries(REQUIRES_PERMISSION)) {
      if (rolePerms[permissionKey] && !rolePerms[requiredKey]) {
        rolePerms[requiredKey] = true;
        changed = true;
      }
    }
  }
  return rolePerms;
};

const normalizePermissionDependencies = (matrix) =>
  ROLE_IDS.reduce((acc, roleId) => {
    acc[roleId] = normalizeRoleDependencies(roleId, matrix?.[roleId]);
    return acc;
  }, {});

const disableDependents = (rolePerms, permissionKey) => {
  const next = { ...rolePerms, [permissionKey]: false };
  let changed = true;
  while (changed) {
    changed = false;
    for (const [dependentKey, requiredKey] of Object.entries(REQUIRES_PERMISSION)) {
      if (requiredKey === permissionKey && next[dependentKey]) {
        next[dependentKey] = false;
        changed = true;
      }
      if (!next[requiredKey] && next[dependentKey]) {
        next[dependentKey] = false;
        changed = true;
      }
    }
  }
  return next;
};

const matricesEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export default function AccessSettingsScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const { refresh: refreshPermissions } = usePermissions();
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const s = React.useMemo(() => styles(theme), [theme]);

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [companyId, setCompanyId] = React.useState(null);
  const [cloudReady, setCloudReady] = React.useState(false);
  const [permMatrix, setPermMatrix] = React.useState(createDefaultMatrix);
  const [initialMatrix, setInitialMatrix] = React.useState(createDefaultMatrix);
  const [selectedRole, setSelectedRole] = React.useState('dispatcher');
  const [expandedSections, setExpandedSections] = React.useState(() => new Set(['requests']));
  const normalizedMatrix = React.useMemo(
    () => normalizePermissionDependencies(permMatrix),
    [permMatrix],
  );
  const dirty = React.useMemo(
    () => !matricesEqual(normalizedMatrix, initialMatrix),
    [initialMatrix, normalizedMatrix],
  );

  React.useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        const userId = userRes?.user?.id;
        if (!userId) throw new Error(t('access_settings_error_user_not_found'));

        const { data: profile, error: profileErr } = await supabase
          .from('profiles')
          .select('company_id')
          .eq('id', userId)
          .maybeSingle();
        if (profileErr) throw profileErr;

        const nextCompanyId = profile?.company_id ?? null;
        if (mounted) setCompanyId(nextCompanyId);
        if (!nextCompanyId) throw new Error(t('access_settings_error_company_missing'));

        const { data: rows, error: permsErr } = await supabase
          .from('app_role_permissions')
          .select('role, key, value')
          .eq('company_id', nextCompanyId);

        if (permsErr) {
          if (mounted) setCloudReady(false);
          return;
        }

        if (mounted) {
          setCloudReady(true);
          if (Array.isArray(rows) && rows.length > 0) {
            const fromDb = { admin: {}, dispatcher: {}, worker: {} };
            for (const row of rows) {
              if (!fromDb[row.role]) fromDb[row.role] = {};
              fromDb[row.role][row.key] = toBool(row.value);
            }
            const nextMatrix = normalizePermissionDependencies(mergeWithDefaults(fromDb));
            setPermMatrix(nextMatrix);
            setInitialMatrix(nextMatrix);
          } else {
            const nextMatrix = normalizePermissionDependencies(createDefaultMatrix());
            setPermMatrix(nextMatrix);
            setInitialMatrix(nextMatrix);
          }
        }
      } catch (error) {
        if (mounted) {
          toast.error(error?.message || t('access_settings_load_failed'));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [t, toast]);

  const onToggle = React.useCallback((roleId, permKey) => {
    if (!EDITABLE_ROLE_IDS.includes(roleId)) return;
    setPermMatrix((prev) => {
      const currentRole = prev[roleId] || {};
      const nextValue = !currentRole?.[permKey];
      let nextRole = nextValue
        ? { ...currentRole, [permKey]: true }
        : disableDependents(currentRole, permKey);
      if (nextValue && REQUIRES_PERMISSION[permKey]) {
        nextRole[REQUIRES_PERMISSION[permKey]] = true;
      }
      const next = {
        ...prev,
        [roleId]: nextRole,
      };
      return normalizePermissionDependencies(next);
    });
  }, []);

  const onSave = React.useCallback(async () => {
    if (!companyId) {
      toast.error(t('access_settings_error_company_missing'));
      return;
    }
    if (!cloudReady) {
      toast.error(t('access_settings_error_table_missing'));
      return;
    }

    setSaving(true);
    try {
      const normalizedMatrix = normalizePermissionDependencies(permMatrix);
      const payload = [];
      for (const roleId of ROLE_IDS) {
        for (const permissionKey of PERSISTED_PERMISSION_KEYS) {
          payload.push({
            company_id: companyId,
            role: roleId,
            key: permissionKey,
            value: !!normalizedMatrix[roleId]?.[permissionKey],
          });
        }
      }

      const { error } = await supabase
        .from('app_role_permissions')
        .upsert(payload, { onConflict: 'company_id,role,key' });
      if (error) throw error;
      setPermMatrix(normalizedMatrix);
      setInitialMatrix(normalizedMatrix);

      try {
        const channel = supabase.channel(BROADCAST_CHANNEL);
        await channel.subscribe();
        try {
          const message = {
            type: 'broadcast',
            event: BROADCAST_EVENT,
            payload: { company_id: companyId, ts: Date.now() },
          };
          if (typeof channel.httpSend === 'function') {
            await channel.httpSend(message);
          } else if (typeof channel.send === 'function') {
            await channel.send(message);
          }
        } catch {
          // best-effort broadcast; ignore errors
        }
        setTimeout(() => {
          try {
            supabase.removeChannel(channel);
          } catch {}
        }, BROADCAST_CLEANUP_DELAY_MS);
      } catch {}

      try {
        await refreshPermissions({ silent: true });
      } catch {}

      toast.success(t('access_settings_saved'));
    } catch (error) {
      toast.error(error?.message || t('access_settings_save_failed'));
    } finally {
      setSaving(false);
    }
  }, [cloudReady, companyId, permMatrix, t, toast, refreshPermissions]);

  const onApplyDefaults = React.useCallback(() => {
    setPermMatrix(normalizePermissionDependencies(createDefaultMatrix()));
    toast.success(t('access_settings_defaults_prepared'));
  }, [t, toast]);

  const toggleSection = React.useCallback((sectionId) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }, []);

  return (
    <Screen
      background="background"
      scroll={false}
      headerOptions={{ title: t('settings_management_access'), helpTopic: 'access_settings' }}
    >
      <KeyboardAwareScrollView
        contentContainerStyle={s.screenContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={SMOOTH_KEYBOARD_DISMISS_MODE}
        showsVerticalScrollIndicator={false}
        bottomOffset={theme.components?.keyboardAware?.bottomOffset ?? 20}
        extraKeyboardSpace={theme.components?.keyboardAware?.extraKeyboardSpace ?? 0}
      >
        <SectionHeader>{t('access_settings_role_title')}</SectionHeader>
        <Card paddedXOnly>
          <View style={s.roleTabs}>
            {EDITABLE_ROLE_IDS.map((roleId) => {
              const active = selectedRole === roleId;
              return (
                <Pressable
                  key={roleId}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => setSelectedRole(roleId)}
                  style={({ pressed }) => [
                    s.roleTab,
                    active && s.roleTabActive,
                    pressed && s.pressed,
                  ]}
                >
                  <Text style={[s.roleTabText, active && s.roleTabTextActive]}>
                    {t(ROLE_LABEL_KEYS[roleId])}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={s.adminNotice}>
            <Feather name="shield" size={18} color={theme.colors.primary} />
            <Text style={s.adminNoticeText}>{t('access_settings_admin_full_access')}</Text>
          </View>
        </Card>

        <Text style={s.hintText}>{t('access_settings_role_hint')}</Text>

        <Button
          title={t('access_settings_apply_defaults')}
          onPress={onApplyDefaults}
          disabled={loading || !cloudReady || saving}
          variant="secondary"
        />

        {loading ? (
          <Card>
            <View style={s.loadingWrap}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={s.loadingText}>{t('access_settings_loading')}</Text>
            </View>
          </Card>
        ) : ACCESS_SECTIONS.map((section) => {
          const expanded = expandedSections.has(section.id);
          const enabledCount = section.permissions.reduce(
            (count, permission) => count + (normalizedMatrix[selectedRole]?.[permission.key] ? 1 : 0),
            0,
          );
          return (
            <Card key={section.id} paddedXOnly>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => toggleSection(section.id)}
                style={({ pressed }) => [s.sectionToggle, pressed && s.pressed]}
              >
                <View style={s.sectionTextWrap}>
                  <Text style={s.sectionTitle}>{t(section.titleKey)}</Text>
                  <Text style={s.sectionDescription}>{t(section.descriptionKey)}</Text>
                  <Text style={s.sectionCount}>
                    {t('access_settings_enabled_count')
                      .replace('{enabled}', String(enabledCount))
                      .replace('{total}', String(section.permissions.length))}
                  </Text>
                </View>
                <Feather
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={theme.icons?.md ?? 22}
                  color={theme.colors.textSecondary}
                />
              </Pressable>
              {expanded ? (
                <SeparatedList>
                  {section.permissions.map((permission) => (
                    <View key={`${section.id}-${permission.key}`} style={s.permissionRow}>
                      <View style={s.permissionTextWrap}>
                        <Text style={[base.label, s.permissionLabel]}>{t(permission.labelKey)}</Text>
                        <Text style={s.permissionDescription}>
                          {t(`${permission.labelKey}_description`)}
                        </Text>
                      </View>
                      <ThemedSwitch
                        value={!!normalizedMatrix[selectedRole]?.[permission.key]}
                        onValueChange={() => onToggle(selectedRole, permission.key)}
                        disabled={saving}
                      />
                    </View>
                  ))}
                </SeparatedList>
              ) : null}
            </Card>
          );
        })}

        {!cloudReady && !loading ? (
          <Text style={s.hintText}>{t('access_settings_table_missing_hint')}</Text>
        ) : null}
      </KeyboardAwareScrollView>
      <View style={s.footerBar}>
        <Button
          title={t('access_settings_save')}
          onPress={onSave}
          formSubmit
          loading={saving}
          disabled={loading || !cloudReady || saving || !dirty}
          style={s.footerButton}
        />
      </View>
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    screenContent: {
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.components.screenLayout.contentPaddingBottom,
      gap: theme.spacing.md,
    },
    loadingWrap: {
      minHeight: (theme.components?.listItem?.height || 56) * 2,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.xl,
      paddingHorizontal: theme.spacing.lg,
    },
    loadingText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    roleTabs: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.md,
    },
    roleTab: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
      paddingHorizontal: theme.spacing.sm,
    },
    roleTabActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary,
    },
    roleTabText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
    },
    roleTabTextActive: {
      color: theme.colors.onPrimary || '#FFFFFF',
    },
    adminNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.md,
    },
    adminNoticeText: {
      flex: 1,
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round(theme.typography.sizes.sm * 1.45),
      fontWeight: theme.typography.weight.medium,
    },
    sectionToggle: {
      minHeight: theme.components?.listItem?.height || 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.md,
    },
    sectionTextWrap: {
      flex: 1,
      gap: 3,
    },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    sectionDescription: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
      lineHeight: Math.round(theme.typography.sizes.xs * 1.4),
    },
    sectionCount: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.semibold,
    },
    permissionRow: {
      minHeight: theme.components?.listItem?.height || 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.md,
    },
    permissionTextWrap: {
      flex: 1,
      gap: 3,
    },
    permissionLabel: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
    },
    permissionDescription: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
      lineHeight: Math.round(theme.typography.sizes.xs * 1.4),
    },
    hintText: {
      color: theme.colors.textSecondary,
      fontSize: theme?.typography?.sizes?.xs ?? 12,
      lineHeight: Math.round((theme?.typography?.sizes?.xs ?? 12) * (theme?.typography?.lineHeights?.relaxed ?? 1.5)),
    },
    footerBar: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.sm,
      paddingBottom: theme.spacing.lg,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      backgroundColor: theme.colors.background,
    },
    pressed: {
      opacity: 0.72,
    },
    footerButton: {
      width: '100%',
    },
  });
