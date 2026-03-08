import { useNavigation } from 'expo-router';
import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, UIManager, View, findNodeHandle } from 'react-native';

import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import ExpandableTextRow from '../../../components/ui/ExpandableTextRow';
import SectionHeader from '../../../components/ui/SectionHeader';
import ThemedSwitch from '../../../components/ui/ThemedSwitch';
import { useToast } from '../../../components/ui/ToastProvider';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { useAuthContext } from '../../../providers/SimpleAuthProvider';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
} from '../../../src/features/fieldSettings/catalog';
import {
  useEntityFieldSettings,
  useSaveEntityFieldSettingsMutation,
} from '../../../src/features/fieldSettings/queries';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const ENTITY_ROWS = [
  {
    id: ENTITY_FIELD_TYPES.ORDER,
    titleKey: 'field_settings_tab_order',
    fallbackTitle: 'Заявки',
  },
  {
    id: ENTITY_FIELD_TYPES.OBJECT,
    titleKey: 'field_settings_tab_object',
    fallbackTitle: 'Объекты',
  },
];

function cloneSettings(settings) {
  return {
    entityType: settings?.entityType || null,
    versionToken: settings?.versionToken || null,
    source: settings?.source || 'fallback',
    fields: (settings?.fields || []).map((field) => ({ ...field })),
  };
}

function toggleFieldEnabled(fields, fieldKey, nextValue) {
  return (fields || []).map((field) => {
    if (String(field.fieldKey || '') !== String(fieldKey || '')) return field;
    if (field.lockedEnabled) {
      return {
        ...field,
        isEnabled: true,
        isRequired: field.lockedRequired ? true : field.isRequired,
      };
    }

    const enabled = !!nextValue;
    return {
      ...field,
      isEnabled: enabled,
      isRequired: enabled ? (field.lockedRequired ? true : field.isRequired) : false,
      canToggleRequired:
        field.supportsRequired === true && field.lockedRequired !== true && enabled === true,
    };
  });
}

function toggleFieldRequired(fields, fieldKey, nextValue) {
  return (fields || []).map((field) => {
    if (String(field.fieldKey || '') !== String(fieldKey || '')) return field;
    if (field.lockedRequired) return { ...field, isEnabled: true, isRequired: true };
    if (field.supportsRequired !== true) return { ...field, isRequired: false };

    const required = !!nextValue;
    return {
      ...field,
      isEnabled: required ? true : field.isEnabled,
      isRequired: required,
      canToggleRequired: true,
    };
  });
}

export default function FieldEditorScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const nav = useNavigation();
  const { profile } = useAuthContext();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const isAdmin = String(profile?.role || '').toLowerCase() === 'admin';

  const orderQuery = useEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER, { enabled: isAdmin });
  const objectQuery = useEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT, { enabled: isAdmin });
  const saveMutation = useSaveEntityFieldSettingsMutation();

  const [expandedMap, setExpandedMap] = React.useState({
    [ENTITY_FIELD_TYPES.ORDER]: true,
    [ENTITY_FIELD_TYPES.OBJECT]: false,
  });
  const [drafts, setDrafts] = React.useState({
    [ENTITY_FIELD_TYPES.ORDER]: null,
    [ENTITY_FIELD_TYPES.OBJECT]: null,
  });
  const [dirtyMap, setDirtyMap] = React.useState({
    [ENTITY_FIELD_TYPES.ORDER]: false,
    [ENTITY_FIELD_TYPES.OBJECT]: false,
  });
  const scrollRef = React.useRef(null);
  const rowRefs = React.useRef({});
  const sectionHeaderHeightRef = React.useRef(0);
  const stickyHeaderHeightRef = React.useRef(0);

  React.useLayoutEffect(() => {
    nav?.setParams?.({ headerTitle: t('settings_management_form_builder', 'Редактор полей') });
  }, [nav, t]);

  React.useEffect(() => {
    const orderData = orderQuery.data || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER);
    setDrafts((prev) =>
      prev[ENTITY_FIELD_TYPES.ORDER] && dirtyMap[ENTITY_FIELD_TYPES.ORDER]
        ? prev
        : { ...prev, [ENTITY_FIELD_TYPES.ORDER]: cloneSettings(orderData) },
    );
  }, [dirtyMap, orderQuery.data]);

  React.useEffect(() => {
    const objectData = objectQuery.data || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT);
    setDrafts((prev) =>
      prev[ENTITY_FIELD_TYPES.OBJECT] && dirtyMap[ENTITY_FIELD_TYPES.OBJECT]
        ? prev
        : { ...prev, [ENTITY_FIELD_TYPES.OBJECT]: cloneSettings(objectData) },
    );
  }, [dirtyMap, objectQuery.data]);

  const queryMap = React.useMemo(
    () => ({
      [ENTITY_FIELD_TYPES.ORDER]: orderQuery,
      [ENTITY_FIELD_TYPES.OBJECT]: objectQuery,
    }),
    [objectQuery, orderQuery],
  );

  const updateDraft = React.useCallback((entityType, updater) => {
    setDrafts((prev) => {
      const current = prev[entityType] || buildFallbackEntityFieldSettings(entityType);
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [entityType]: next };
    });
    setDirtyMap((prev) => ({ ...prev, [entityType]: true }));
  }, []);

  const resetDraft = React.useCallback(
    (entityType) => {
      const source =
        entityType === ENTITY_FIELD_TYPES.ORDER
          ? orderQuery.data || buildFallbackEntityFieldSettings(entityType)
          : objectQuery.data || buildFallbackEntityFieldSettings(entityType);

      setDrafts((prev) => ({ ...prev, [entityType]: cloneSettings(source) }));
      setDirtyMap((prev) => ({ ...prev, [entityType]: false }));
    },
    [objectQuery.data, orderQuery.data],
  );

  const handleToggleEnabled = React.useCallback(
    (entityType, fieldKey, nextValue) => {
      updateDraft(entityType, (current) => ({
        ...current,
        fields: toggleFieldEnabled(current.fields, fieldKey, nextValue),
      }));
    },
    [updateDraft],
  );

  const handleToggleRequired = React.useCallback(
    (entityType, fieldKey, nextValue) => {
      updateDraft(entityType, (current) => ({
        ...current,
        fields: toggleFieldRequired(current.fields, fieldKey, nextValue),
      }));
    },
    [updateDraft],
  );

  const handleSave = React.useCallback(
    async (entityType) => {
      const current = drafts[entityType];
      const entityQuery = queryMap[entityType];
      if (!current) return;

      try {
        const saved = await saveMutation.mutateAsync({
          entityType,
          fields: current.fields,
          expectedVersion: current.versionToken,
        });

        setDrafts((prev) => ({ ...prev, [entityType]: cloneSettings(saved) }));
        setDirtyMap((prev) => ({ ...prev, [entityType]: false }));
        toast.success(
          t(
            'field_settings_saved',
            entityType === ENTITY_FIELD_TYPES.ORDER
              ? 'Настройки полей заявок сохранены'
              : 'Настройки полей объектов сохранены',
          ),
        );
      } catch (error) {
        const raw = String(error?.message || '').toUpperCase();
        if (raw.includes('FIELD_SETTINGS_CONFLICT')) {
          await entityQuery.refetch();
          resetDraft(entityType);
          toast.warning(
            t(
              'field_settings_conflict',
              'Настройки уже изменил другой администратор. Экран обновлен до последней версии.',
            ),
          );
          return;
        }

        toast.error(
          String(
            error?.message || t('field_settings_save_failed', 'Не удалось сохранить настройки полей'),
          ),
        );
      }
    },
    [drafts, queryMap, resetDraft, saveMutation, t, toast],
  );

  const scrollToExpandedRow = React.useCallback((entityType) => {
    if (!scrollRef.current?.scrollTo) return;

    const targetHandle = findNodeHandle(rowRefs.current?.[entityType]);
    const scrollHandle = findNodeHandle(scrollRef.current);
    if (!targetHandle || !scrollHandle) return;

    const sectionHeaderHeight = Number(sectionHeaderHeightRef.current || 0);
    const stickyHeaderHeight = Number(stickyHeaderHeightRef.current || 0);
    UIManager.measureLayout(
      targetHandle,
      scrollHandle,
      () => {},
      (_x, y) => {
        const targetY = Math.max(0, y - stickyHeaderHeight - sectionHeaderHeight);
        scrollRef.current?.scrollTo({ y: targetY, animated: true });
      },
    );
  }, []);

  const toggleExpanded = React.useCallback(
    (entityType) => {
      let shouldScrollToRow = false;

      setExpandedMap((prev) => {
        const nextValue = !prev[entityType];
        shouldScrollToRow = nextValue;
        return {
          [ENTITY_FIELD_TYPES.ORDER]: false,
          [ENTITY_FIELD_TYPES.OBJECT]: false,
          [entityType]: nextValue,
        };
      });

      if (shouldScrollToRow) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scrollToExpandedRow(entityType);
          });
        });
      }
    },
    [scrollToExpandedRow],
  );

  const renderFieldRow = React.useCallback(
    (entityType, field, index) => {
      const requiredDisabled =
        field.supportsRequired !== true ||
        field.isEnabled === false ||
        field.lockedRequired === true ||
        saveMutation.isPending;

      return (
        <React.Fragment key={field.fieldKey}>
          {index > 0 ? <View style={base.sep} /> : null}
          <View style={[base.row, s.fieldRow, field.isEnabled === false ? s.fieldRowDisabled : null]}>
            <View style={s.fieldInfo}>
              <Text style={[base.label, s.fieldTitle, field.isEnabled === false ? s.fieldTitleDisabled : null]}>
                {t(field.labelKey, field.fallbackLabel || field.fieldKey)}
              </Text>
            </View>
            <View style={s.fieldControls}>
              <View style={s.fieldSwitchCell}>
                <ThemedSwitch
                  value={field.isEnabled !== false}
                  onValueChange={(value) => handleToggleEnabled(entityType, field.fieldKey, value)}
                  disabled={field.canToggleEnabled === false || saveMutation.isPending}
                />
              </View>
              <View style={s.fieldSwitchCell}>
                <ThemedSwitch
                  value={field.isRequired === true}
                  onValueChange={(value) => handleToggleRequired(entityType, field.fieldKey, value)}
                  disabled={requiredDisabled}
                />
              </View>
            </View>
          </View>
        </React.Fragment>
      );
    },
    [base.label, base.row, base.sep, handleToggleEnabled, handleToggleRequired, s, saveMutation.isPending, t],
  );

  const renderEntityEditor = React.useCallback(
    (entityType) => {
      const draft = drafts[entityType];
      const query = queryMap[entityType];
      const visibleFields = draft?.fields || [];
      const hasDirty = dirtyMap[entityType];

      if (query.isLoading && !draft) {
        return (
          <View style={s.loadingWrap}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        );
      }

      return (
        <View style={s.editorWrap}>
          {visibleFields.length ? (
            visibleFields.map((field, index) => renderFieldRow(entityType, field, index))
          ) : (
            <View style={s.emptyWrap}>
              <Text style={s.muted}>
                {t('field_settings_empty_search', 'Поля для редактирования не найдены.')}
              </Text>
            </View>
          )}

          <View style={s.footer}>
            <Button
              title={t('btn_cancel', 'Отмена')}
              variant="secondary"
              onPress={() => resetDraft(entityType)}
              disabled={!hasDirty || saveMutation.isPending}
              style={s.footerButton}
            />
            <Button
              title={saveMutation.isPending ? t('toast_saving', 'Сохраняем…') : t('btn_save', 'Сохранить')}
              onPress={() => handleSave(entityType)}
              disabled={!hasDirty || saveMutation.isPending}
              style={s.footerButton}
            />
          </View>
        </View>
      );
    },
    [dirtyMap, drafts, handleSave, queryMap, renderFieldRow, resetDraft, s, saveMutation.isPending, t, theme.colors.primary],
  );

  if (!isAdmin) {
    return (
      <Screen background="background">
        <View style={s.center}>
          <Text style={s.muted}>
            {t('field_settings_admin_only', 'Редактор полей доступен только администратору компании.')}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen background="background" scroll={false}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={[1]}
      >
        <View
          onLayout={(event) => {
            sectionHeaderHeightRef.current = event.nativeEvent.layout.height;
          }}
        >
          <SectionHeader topSpacing="xs" bottomSpacing="xs">
            {t('field_settings_editing_title', 'Редактирование')}
          </SectionHeader>
        </View>
        <View style={s.stickyHeaderShell}>
          <View
            onLayout={(event) => {
              stickyHeaderHeightRef.current = event.nativeEvent.layout.height;
            }}
          >
            <Card paddedXOnly style={s.fieldHeaderCard}>
              <View style={[base.row, s.fieldHeaderRow]}>
                <View style={s.fieldInfo}>
                  <Text style={s.fieldHeaderSpacer} />
                </View>
                <View style={s.fieldControls}>
                  <Text style={s.fieldColumnTitle}>{t('field_settings_toggle_enabled', 'Показ')}</Text>
                  <Text style={s.fieldColumnTitle}>{t('field_settings_toggle_required', 'Обязательно')}</Text>
                </View>
              </View>
              <View style={base.sep} />
            </Card>
          </View>
        </View>
        <Card paddedXOnly style={s.fieldBodyCard}>
          {ENTITY_ROWS.map((row, index) => {
            const isExpanded = expandedMap[row.id];

            return (
              <View
                key={row.id}
                ref={(node) => {
                  rowRefs.current[row.id] = node;
                }}
              >
                {index > 0 ? <View style={base.sep} /> : null}
                <ExpandableTextRow
                  key={`${row.id}-${isExpanded ? 'expanded' : 'collapsed'}`}
                  label={t(row.titleKey, row.fallbackTitle)}
                  value=""
                  collapsedValue=""
                  forceShow
                  toggleOnChevronOnly={false}
                  initiallyExpanded={isExpanded}
                  onChevronPress={() => toggleExpanded(row.id)}
                  onValuePress={() => toggleExpanded(row.id)}
                  chevronName={isExpanded ? 'chevron-up' : 'chevron-down'}
                />
                {isExpanded ? (
                  <View style={s.groupedFieldsWrap}>
                    <View style={base.sep} />
                    {renderEntityEditor(row.id)}
                  </View>
                ) : null}
              </View>
            );
          })}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function createStyles(theme) {
  const switchTrackWidth = Number(
    theme.components?.switch?.trackWidth ?? theme.components?.listItem?.height ?? 48,
  );
  const switchColumnWidth = switchTrackWidth + theme.spacing.lg;
  const switchColumnsWidth = switchColumnWidth * 2 + theme.spacing.sm;

  return StyleSheet.create({
    content: {
      padding: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
      gap: 0,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: theme.spacing.lg,
    },
    stickyHeaderShell: {
      backgroundColor: theme.colors.background,
      zIndex: 1,
    },
    editorWrap: {
      paddingTop: 0,
      paddingHorizontal: theme.spacing.xs,
      paddingBottom: theme.spacing.sm,
      gap: 0,
    },
    loadingWrap: {
      minHeight: theme.components?.listItem?.height ?? theme.spacing.xxxl,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.lg,
    },
    fieldHeaderCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.lg,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      borderBottomWidth: 0,
      marginBottom: 0,
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
      marginTop: 0,
      shadowColor: 'transparent',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    fieldHeaderRow: {
      gap: theme.spacing.md,
      paddingTop: 0,
      paddingBottom: 0,
      alignItems: 'center',
    },
    fieldHeaderSpacer: {
      minHeight: 1,
    },
    fieldRow: {
      gap: theme.spacing.md,
      alignItems: 'center',
      paddingTop: 0,
      paddingBottom: 0,
    },
    fieldRowDisabled: {
      opacity: 0.48,
    },
    fieldInfo: {
      flex: 1,
      minWidth: 0,
      paddingRight: theme.spacing.md,
    },
    fieldTitle: {
      color: theme.colors.text,
    },
    fieldTitleDisabled: {
      color: theme.colors.textSecondary,
    },
    fieldControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      flexShrink: 0,
      width: switchColumnsWidth,
      justifyContent: 'space-between',
    },
    fieldSwitchCell: {
      width: switchColumnWidth,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fieldColumnTitle: {
      width: switchColumnWidth,
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: 20,
      textAlign: 'center',
    },
    groupedFieldsWrap: {
      paddingLeft: theme.spacing.lg,
    },
    emptyWrap: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.lg,
    },
    muted: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    footer: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.sm,
    },
    footerButton: {
      flex: 1,
    },
  });
}
