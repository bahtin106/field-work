import { Feather } from '@expo/vector-icons';
import { useNavigation } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
  findNodeHandle,
} from 'react-native';

import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import ThemedSwitch from '../../../components/ui/ThemedSwitch';
import { useToast } from '../../../components/ui/ToastProvider';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { useAuthContext } from '../../../providers/SimpleAuthProvider';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getOrderedEntityFields,
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
    fallbackTitle: 'Новые объекты',
  },
  {
    id: ENTITY_FIELD_TYPES.EMPLOYEE,
    titleKey: 'field_settings_tab_employee',
    fallbackTitle: 'Сотрудники',
  },
  {
    id: ENTITY_FIELD_TYPES.CLIENT,
    titleKey: 'field_settings_tab_client',
    fallbackTitle: 'Клиенты',
  },
];

const DEFAULT_EXPANDED_ENTITY = ENTITY_FIELD_TYPES.ORDER;
const AUTO_RETRY_BASE_DELAY_MS = 4000;
const AUTO_RETRY_MAX_DELAY_MS = 30000;
const AUTO_RETRY_MAX_ATTEMPTS = 3;

const HIDDEN_EDITOR_FIELDS = Object.freeze({
  [ENTITY_FIELD_TYPES.ORDER]: new Set([
    'title',
    'phone',
    'work_type_id',
    'department_id',
    'client_id',
    'object_id',
    'assigned_to',
    'start_price',
    'payment_status',
    'payment_method',
  ]),
  [ENTITY_FIELD_TYPES.EMPLOYEE]: new Set([
    'first_name',
    'last_name',
    'middle_name',
    'email',
    'role',
  ]),
  [ENTITY_FIELD_TYPES.CLIENT]: new Set([
    'first_name',
    'last_name',
    'middle_name',
    'phone',
  ]),
});

const ORDER_MEDIA_RENAMABLE_FIELDS = new Set([
  'media_file_1',
  'media_file_2',
  'media_file_3',
  'media_file_4',
  'media_file_5',
]);

function cloneSettings(settings) {
  return {
    entityType: settings?.entityType || null,
    versionToken: settings?.versionToken || null,
    source: settings?.source || 'fallback',
    fields: (settings?.fields || []).map((field) => ({ ...field })),
  };
}

function buildEntityState(initialValue) {
  return ENTITY_ROWS.reduce((acc, row) => {
    acc[row.id] = initialValue;
    return acc;
  }, {});
}

function buildEntitySaveState() {
  return ENTITY_ROWS.reduce((acc, row) => {
    acc[row.id] = { phase: 'idle', lastSavedAt: null, errorMessage: null };
    return acc;
  }, {});
}

function getEntityMeta(entityType, t) {
  const row = ENTITY_ROWS.find((item) => item.id === entityType);
  return {
    title: row ? t(row.titleKey, row.fallbackTitle) : String(entityType || ''),
  };
}

function sanitizeEditorLabel(rawLabel) {
  return String(rawLabel || '')
    .replace(/\s*\*+\s*$/u, '')
    .trim();
}

function serializeFieldState(fields) {
  return JSON.stringify(
    (Array.isArray(fields) ? fields : []).map((field) => ({
      fieldKey: String(field.fieldKey || field.field_key || ''),
      isEnabled: field.isEnabled !== false,
      isRequired: field.isRequired === true,
      customLabel:
        typeof field.customLabel === 'string' && field.customLabel.trim()
          ? field.customLabel.trim()
          : null,
    })),
  );
}

function isTransientSaveError(error) {
  const message = String(error?.message || '').toUpperCase();
  return (
    message.includes('PGRST003') ||
    message.includes('CONNECTION POOL') ||
    message.includes('TIMED OUT ACQUIRING CONNECTION') ||
    message.includes('NETWORK REQUEST FAILED') ||
    message.includes('FAILED TO FETCH') ||
    message.includes('FETCH FAILED')
  );
}

function getRetryDelayMs(attempt) {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, attempt) : 0;
  return Math.min(AUTO_RETRY_MAX_DELAY_MS, AUTO_RETRY_BASE_DELAY_MS * 2 ** safeAttempt);
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

function hasAtLeastOneEnabledField(fields) {
  return (Array.isArray(fields) ? fields : []).some((field) => field?.isEnabled !== false);
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
  const employeeQuery = useEntityFieldSettings(ENTITY_FIELD_TYPES.EMPLOYEE, { enabled: isAdmin });
  const clientQuery = useEntityFieldSettings(ENTITY_FIELD_TYPES.CLIENT, { enabled: isAdmin });
  const saveMutation = useSaveEntityFieldSettingsMutation();

  const [expandedMap, setExpandedMap] = React.useState(() => ({
    ...buildEntityState(false),
    [DEFAULT_EXPANDED_ENTITY]: true,
  }));
  const [drafts, setDrafts] = React.useState(() => buildEntityState(null));
  const [dirtyMap, setDirtyMap] = React.useState(() => buildEntityState(false));
  const [saveStateMap, setSaveStateMap] = React.useState(() => buildEntitySaveState());
  const [labelEditField, setLabelEditField] = React.useState(null);
  const [labelDraftValue, setLabelDraftValue] = React.useState('');
  const labelInputRef = React.useRef(null);
  const scrollRef = React.useRef(null);
  const rowRefs = React.useRef({});
  const stickyHeaderHeightRef = React.useRef(0);
  const draftsRef = React.useRef(drafts);
  const dirtyMapRef = React.useRef(dirtyMap);
  const queryMapRef = React.useRef(null);
  const saveTimersRef = React.useRef({});
  const retryTimersRef = React.useRef({});
  const inFlightRef = React.useRef(buildEntityState(false));
  const queuedSaveRef = React.useRef(buildEntityState(false));
  const lastErrorToastRef = React.useRef(buildEntityState(false));
  const retryAttemptRef = React.useRef(buildEntityState(0));
  const globalSaveLockRef = React.useRef(false);

  React.useLayoutEffect(() => {
    nav?.setParams?.({ headerTitle: t('settings_management_form_builder', 'Редактор полей') });
  }, [nav, t]);

  React.useEffect(() => {
    const nextData = orderQuery.data || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER);
    setDrafts((prev) =>
      prev[ENTITY_FIELD_TYPES.ORDER] && dirtyMap[ENTITY_FIELD_TYPES.ORDER]
        ? prev
        : { ...prev, [ENTITY_FIELD_TYPES.ORDER]: cloneSettings(nextData) },
    );
  }, [dirtyMap, orderQuery.data]);

  React.useEffect(() => {
    const nextData = objectQuery.data || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT);
    setDrafts((prev) =>
      prev[ENTITY_FIELD_TYPES.OBJECT] && dirtyMap[ENTITY_FIELD_TYPES.OBJECT]
        ? prev
        : { ...prev, [ENTITY_FIELD_TYPES.OBJECT]: cloneSettings(nextData) },
    );
  }, [dirtyMap, objectQuery.data]);

  React.useEffect(() => {
    const nextData = employeeQuery.data || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.EMPLOYEE);
    setDrafts((prev) =>
      prev[ENTITY_FIELD_TYPES.EMPLOYEE] && dirtyMap[ENTITY_FIELD_TYPES.EMPLOYEE]
        ? prev
        : { ...prev, [ENTITY_FIELD_TYPES.EMPLOYEE]: cloneSettings(nextData) },
    );
  }, [dirtyMap, employeeQuery.data]);

  React.useEffect(() => {
    const nextData = clientQuery.data || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.CLIENT);
    setDrafts((prev) =>
      prev[ENTITY_FIELD_TYPES.CLIENT] && dirtyMap[ENTITY_FIELD_TYPES.CLIENT]
        ? prev
        : { ...prev, [ENTITY_FIELD_TYPES.CLIENT]: cloneSettings(nextData) },
    );
  }, [clientQuery.data, dirtyMap]);

  const queryMap = React.useMemo(
    () => ({
      [ENTITY_FIELD_TYPES.ORDER]: orderQuery,
      [ENTITY_FIELD_TYPES.OBJECT]: objectQuery,
      [ENTITY_FIELD_TYPES.EMPLOYEE]: employeeQuery,
      [ENTITY_FIELD_TYPES.CLIENT]: clientQuery,
    }),
    [clientQuery, employeeQuery, objectQuery, orderQuery],
  );

  React.useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  React.useEffect(() => {
    dirtyMapRef.current = dirtyMap;
  }, [dirtyMap]);

  React.useEffect(() => {
    queryMapRef.current = queryMap;
  }, [queryMap]);

  React.useEffect(() => () => {
    Object.values(saveTimersRef.current || {}).forEach((timerId) => clearTimeout(timerId));
    Object.values(retryTimersRef.current || {}).forEach((timerId) => clearTimeout(timerId));
  }, []);

  const persistEntityDraft = React.useCallback(
    async (entityType, options = {}) => {
      const current = draftsRef.current?.[entityType];
      const entityQuery = queryMapRef.current?.[entityType];
      if (!current) return;
      if (!hasAtLeastOneEnabledField(current.fields)) {
        setSaveStateMap((prev) => ({
          ...prev,
          [entityType]: {
            ...prev[entityType],
            phase: 'error',
            errorMessage: t(
              'field_settings_min_enabled_one',
              'Нельзя отключить все поля. Оставьте включенным хотя бы одно поле.',
            ),
          },
        }));
        if (!lastErrorToastRef.current[entityType] || options.showErrorToast === true) {
          toast.warning(
            t(
              'field_settings_min_enabled_one',
              'Нельзя отключить все поля. Оставьте включенным хотя бы одно поле.',
            ),
          );
          lastErrorToastRef.current[entityType] = true;
        }
        return;
      }

      if (inFlightRef.current[entityType]) {
        queuedSaveRef.current[entityType] = true;
        return;
      }

      if (globalSaveLockRef.current) {
        queuedSaveRef.current[entityType] = true;
        setSaveStateMap((prev) => ({
          ...prev,
          [entityType]: {
            ...prev[entityType],
            phase: 'queued',
            errorMessage: null,
          },
        }));
        return;
      }

      clearTimeout(saveTimersRef.current[entityType]);
      saveTimersRef.current[entityType] = null;
      clearTimeout(retryTimersRef.current[entityType]);
      retryTimersRef.current[entityType] = null;
      inFlightRef.current[entityType] = true;
      globalSaveLockRef.current = true;
      queuedSaveRef.current[entityType] = false;
      const serializedBeforeRequest = serializeFieldState(current.fields);
      const versionBeforeRequest = current.versionToken || null;

      setSaveStateMap((prev) => ({
        ...prev,
        [entityType]: {
          ...prev[entityType],
          phase: 'saving',
          errorMessage: null,
        },
      }));

      try {
        const saved = await saveMutation.mutateAsync({
          entityType,
          fields: current.fields,
          expectedVersion: current.versionToken,
        });

        const latestDraft = draftsRef.current?.[entityType];
        const unchanged =
          !!latestDraft &&
          serializeFieldState(latestDraft.fields) === serializedBeforeRequest &&
          String(latestDraft.versionToken || '') === String(versionBeforeRequest || '');

        setDrafts((prev) => {
          const liveDraft = prev[entityType];
          if (!liveDraft) return prev;
          return {
            ...prev,
            [entityType]: unchanged
              ? cloneSettings(saved)
              : {
                  ...liveDraft,
                  versionToken: saved.versionToken,
                  source: saved.source,
                },
          };
        });
        setDirtyMap((prev) => ({
          ...prev,
          [entityType]: unchanged ? false : prev[entityType],
        }));
        retryAttemptRef.current[entityType] = 0;
        lastErrorToastRef.current[entityType] = false;
        setSaveStateMap((prev) => ({
          ...prev,
          [entityType]: {
            phase: unchanged ? 'saved' : 'queued',
            lastSavedAt: Date.now(),
            errorMessage: null,
          },
        }));
        toast.success(
          t('field_settings_saved', 'Настройки полей «{entity}» сохранены').replace(
            '{entity}',
            getEntityMeta(entityType, t).title,
          ),
        );
      } catch (error) {
        const raw = String(error?.message || '').toUpperCase();
        const isConflict = raw.includes('FIELD_SETTINGS_CONFLICT');
        const isTransient = isTransientSaveError(error);

        if (isConflict) {
          await entityQuery?.refetch?.();
          const freshSource =
            queryMapRef.current?.[entityType]?.data || buildFallbackEntityFieldSettings(entityType);
          setDrafts((prev) => ({ ...prev, [entityType]: cloneSettings(freshSource) }));
          setDirtyMap((prev) => ({ ...prev, [entityType]: false }));
        }

        setSaveStateMap((prev) => ({
          ...prev,
          [entityType]: {
            ...prev[entityType],
            phase: isTransient ? 'queued' : 'error',
            errorMessage: String(
              error?.message || t('field_settings_save_failed', 'Не удалось сохранить настройки полей'),
            ),
          },
        }));

        if (
          !isTransient &&
          (!lastErrorToastRef.current[entityType] || isConflict || options.showErrorToast === true)
        ) {
          toast.error(
            String(
              isConflict
                ? t(
                    'field_settings_conflict',
                    'Настройки уже изменил другой администратор. Экран обновлен до последней версии.',
                  )
                : error?.message || t('field_settings_save_failed', 'Не удалось сохранить настройки полей'),
            ),
          );
          lastErrorToastRef.current[entityType] = true;
        }

        if (
          !isConflict &&
          dirtyMapRef.current?.[entityType] &&
          retryAttemptRef.current[entityType] < AUTO_RETRY_MAX_ATTEMPTS
        ) {
          const nextAttempt = retryAttemptRef.current[entityType] + 1;
          retryAttemptRef.current[entityType] = nextAttempt;
          retryTimersRef.current[entityType] = setTimeout(() => {
            void persistEntityDraft(entityType, { showErrorToast: false });
          }, getRetryDelayMs(nextAttempt - 1));
        } else if (isTransient) {
          setSaveStateMap((prev) => ({
            ...prev,
            [entityType]: {
              ...prev[entityType],
              phase: 'error',
              errorMessage: String(
                error?.message || t('field_settings_save_failed', 'Не удалось сохранить настройки полей'),
              ),
            },
          }));

          if (!lastErrorToastRef.current[entityType]) {
            toast.error(
              String(
                error?.message ||
                  t('field_settings_save_failed', 'Не удалось сохранить настройки полей'),
              ),
            );
            lastErrorToastRef.current[entityType] = true;
          }
        }
      } finally {
        inFlightRef.current[entityType] = false;
        globalSaveLockRef.current = false;
        const shouldSaveQueued = queuedSaveRef.current[entityType] === true;
        if (shouldSaveQueued) {
          queuedSaveRef.current[entityType] = false;
          void persistEntityDraft(entityType, { showErrorToast: false });
        } else {
          const nextQueuedEntity = ENTITY_ROWS.find((row) => queuedSaveRef.current[row.id] === true)?.id;
          if (nextQueuedEntity) {
            queuedSaveRef.current[nextQueuedEntity] = false;
            void persistEntityDraft(nextQueuedEntity, { showErrorToast: false });
          }
        }
      }
    },
    [saveMutation, t, toast],
  );

  const updateDraft = React.useCallback((entityType, updater) => {
    setDrafts((prev) => {
      const current = prev[entityType] || buildFallbackEntityFieldSettings(entityType);
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [entityType]: next };
    });
    setDirtyMap((prev) => ({ ...prev, [entityType]: true }));
    setSaveStateMap((prev) => ({
      ...prev,
      [entityType]: {
        ...prev[entityType],
        phase: inFlightRef.current[entityType] ? 'queued' : 'idle',
        errorMessage: null,
      },
    }));
  }, []);

  const hasDirtyChanges = React.useMemo(
    () => ENTITY_ROWS.some((row) => dirtyMap[row.id] === true),
    [dirtyMap],
  );

  const isSavingAny = React.useMemo(
    () => ENTITY_ROWS.some((row) => saveStateMap[row.id]?.phase === 'saving'),
    [saveStateMap],
  );

  const handleSaveAll = React.useCallback(async () => {
    for (const row of ENTITY_ROWS) {
      if (dirtyMapRef.current?.[row.id] !== true) continue;
      await persistEntityDraft(row.id, { showErrorToast: true });
    }
  }, [persistEntityDraft]);

  const handleToggleEnabled = React.useCallback(
    (entityType, fieldKey, nextValue) => {
      const current = draftsRef.current?.[entityType];
      if (!nextValue) {
        const nextFields = toggleFieldEnabled(current?.fields || [], fieldKey, false);
        if (!hasAtLeastOneEnabledField(nextFields)) {
          toast.warning(
            t(
              'field_settings_min_enabled_one',
              'Нельзя отключить все поля. Оставьте включенным хотя бы одно поле.',
            ),
          );
          return;
        }
      }
      updateDraft(entityType, (current) => ({
        ...current,
        fields: toggleFieldEnabled(current.fields, fieldKey, nextValue),
      }));
    },
    [t, toast, updateDraft],
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

  const canEditFieldLabel = React.useCallback((entityType, field) => {
    if (entityType !== ENTITY_FIELD_TYPES.ORDER) return false;
    const fieldKey = String(field?.fieldKey || field?.field_key || '');
    return ORDER_MEDIA_RENAMABLE_FIELDS.has(fieldKey);
  }, []);

  const openLabelEditor = React.useCallback((entityType, field) => {
    if (!canEditFieldLabel(entityType, field)) return;
    setLabelEditField({
      entityType,
      fieldKey: String(field?.fieldKey || field?.field_key || ''),
    });
    setLabelDraftValue(String(field?.customLabel || field?.custom_label || '').trim());
  }, [canEditFieldLabel]);

  const closeLabelEditor = React.useCallback(() => {
    setLabelEditField(null);
    setLabelDraftValue('');
  }, []);

  const applyLabelEditor = React.useCallback(() => {
    if (!labelEditField?.entityType || !labelEditField?.fieldKey) {
      closeLabelEditor();
      return;
    }
    const nextCustomLabel = String(labelDraftValue || '').trim();
    updateDraft(labelEditField.entityType, (current) => ({
      ...current,
      fields: (current.fields || []).map((field) => {
        const fieldKey = String(field.fieldKey || field.field_key || '');
        if (fieldKey !== labelEditField.fieldKey) return field;
        return {
          ...field,
          customLabel: nextCustomLabel || null,
          custom_label: nextCustomLabel || null,
        };
      }),
    }));
    closeLabelEditor();
  }, [closeLabelEditor, labelDraftValue, labelEditField, updateDraft]);

  React.useEffect(() => {
    if (!labelEditField) return;
    const timer = setTimeout(() => labelInputRef.current?.focus?.(), 30);
    return () => clearTimeout(timer);
  }, [labelEditField]);

  const getEntityStatusLabel = React.useCallback((entityType) => {
    const state = saveStateMap[entityType];
    if (!state) return null;
    if (state.phase === 'saving') return t('toast_saving', 'Сохраняем…');
    if (state.phase === 'queued') return t('field_settings_saving_pending', 'Подготовка сохранения…');
    if (state.phase === 'error') return t('field_settings_unsaved', 'Не сохранено');
    if (state.phase === 'saved') return t('field_settings_saved_short', 'Сохранено');
    return null;
  }, [saveStateMap, t]);

  const scrollToExpandedRow = React.useCallback((entityType) => {
    if (!scrollRef.current?.scrollTo) return;

    const targetHandle = findNodeHandle(rowRefs.current?.[entityType]);
    const scrollHandle = findNodeHandle(scrollRef.current);
    if (!targetHandle || !scrollHandle) return;

    const stickyHeaderHeight = Number(stickyHeaderHeightRef.current || 0);
    UIManager.measureLayout(
      targetHandle,
      scrollHandle,
      () => {},
      (_x, y) => {
        const targetY = Math.max(0, y - stickyHeaderHeight);
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
          ...buildEntityState(false),
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
        field.lockedRequired === true;

      const defaultLabel = sanitizeEditorLabel(t(field.labelKey, field.fallbackLabel || field.fieldKey));
      const customLabel = String(field.customLabel || field.custom_label || '').trim();
      const translatedLabel = customLabel || defaultLabel;
      const allowCustomLabelEdit = canEditFieldLabel(entityType, field);
      const isLabelEditing =
        !!labelEditField &&
        labelEditField.entityType === entityType &&
        labelEditField.fieldKey === String(field.fieldKey || field.field_key || '');

      return (
        <React.Fragment key={field.fieldKey}>
          {index > 0 ? <View style={base.sep} /> : null}
          <View style={[base.row, s.fieldRow, field.isEnabled === false ? s.fieldRowDisabled : null]}>
            <View style={s.fieldInfo}>
              <View style={s.fieldTitleRow}>
                {allowCustomLabelEdit && !isLabelEditing ? (
                  <Pressable
                    onPress={() => openLabelEditor(entityType, field)}
                    style={({ pressed }) => [
                      s.fieldEditIconBtn,
                      s.fieldEditIconBtnInline,
                      pressed ? s.fieldEditIconBtnPressed : null,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t('common_edit', 'Изменить')}
                  >
                    <Feather
                      name="edit-2"
                      size={Math.max(10, Math.round((theme.icons?.sm ?? 16) / 1.5))}
                      color={theme.colors.textSecondary}
                    />
                  </Pressable>
                ) : null}
                {isLabelEditing ? (
                  <TextInput
                    ref={labelInputRef}
                    value={labelDraftValue}
                    onChangeText={(nextText) =>
                      setLabelDraftValue(String(nextText || '').replace(/[\r\n]+/g, ' ').slice(0, 64))
                    }
                    onBlur={applyLabelEditor}
                    maxLength={64}
                    multiline
                    scrollEnabled={false}
                    returnKeyType="done"
                    blurOnSubmit
                    onSubmitEditing={() => {
                      applyLabelEditor();
                      labelInputRef.current?.blur?.();
                    }}
                    style={s.fieldTitleInput}
                    accessibilityLabel={t('field_settings_edit_label_input', 'Пользовательское название')}
                  />
                ) : (
                  <Text style={[base.label, s.fieldTitle, field.isEnabled === false ? s.fieldTitleDisabled : null]}>
                    {translatedLabel}
                  </Text>
                )}
              </View>
            </View>
            <View style={s.fieldControls}>
              <View style={s.fieldSwitchCell}>
                <ThemedSwitch
                  value={field.isEnabled !== false}
                  onValueChange={(value) => handleToggleEnabled(entityType, field.fieldKey, value)}
                  disabled={field.canToggleEnabled === false}
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
    [
      base.label,
      base.row,
      base.sep,
      canEditFieldLabel,
      handleToggleEnabled,
      handleToggleRequired,
      labelDraftValue,
      labelEditField,
      openLabelEditor,
      applyLabelEditor,
      s,
      t,
      theme.colors.textSecondary,
      theme.icons?.sm,
    ],
  );

  const renderEntityEditor = React.useCallback(
    (entityType) => {
      const draft = drafts[entityType];
      const query = queryMap[entityType];
      const hiddenFieldKeys = HIDDEN_EDITOR_FIELDS[entityType] || null;
      const visibleFields = getOrderedEntityFields(draft, { lockedFirst: true }).filter((field) => {
        if (!hiddenFieldKeys) return true;
        const fieldKey = String(field?.fieldKey || field?.field_key || '');
        return !hiddenFieldKeys.has(fieldKey);
      });

      if (query?.isLoading && !draft) {
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
        </View>
      );
    },
    [drafts, queryMap, renderFieldRow, s, t, theme.colors.primary],
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
        stickyHeaderIndices={[0]}
      >
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
            const isExpanded = expandedMap[row.id] === true;
            const statusLabel = getEntityStatusLabel(row.id);
            const isError = saveStateMap[row.id]?.phase === 'error';

            return (
              <View
                key={row.id}
                ref={(node) => {
                  rowRefs.current[row.id] = node;
                }}
              >
                {index > 0 ? <View style={base.sep} /> : null}
                <Pressable
                  style={[base.row, s.entityToggleRow]}
                  onPress={() => toggleExpanded(row.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isExpanded }}
                >
                  <View style={s.entityTitleWrap}>
                    <Text
                      style={[
                        base.label,
                        s.entityToggleLabel,
                        isExpanded ? s.entityToggleLabelExpanded : null,
                      ]}
                    >
                      {t(row.titleKey, row.fallbackTitle)}
                    </Text>
                    {statusLabel ? (
                      <Text
                        style={[
                          s.entityStatusText,
                          isError ? s.entityStatusError : null,
                        ]}
                        numberOfLines={1}
                      >
                        {statusLabel}
                      </Text>
                    ) : null}
                  </View>
                  <View style={s.entityToggleChevron}>
                    <Feather
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={theme.components?.listItem?.chevronSize ?? theme.icons?.md ?? 18}
                      color={theme.colors.textSecondary}
                    />
                  </View>
                </Pressable>
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
      <View style={s.footerBar}>
        <Button
          title={isSavingAny ? t('btn_saving', 'Saving...') : t('btn_save', 'Save')}
          onPress={() => {
            void handleSaveAll();
          }}
          loading={isSavingAny}
          disabled={!hasDirtyChanges || isSavingAny}
          style={s.footerButton}
        />
      </View>
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
      paddingBottom: theme.spacing.xxl + 88,
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
    footerBar: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.sm,
      paddingBottom: theme.spacing.lg,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      backgroundColor: theme.colors.background,
    },
    footerButton: {
      width: '100%',
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
    fieldInfo: {
      flex: 1,
      minWidth: 0,
      paddingRight: theme.spacing.md,
    },
    fieldTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 0,
    },
    fieldControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      flexShrink: 0,
      width: switchColumnsWidth,
      justifyContent: 'space-between',
    },
    fieldColumnTitle: {
      width: switchColumnWidth,
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: 20,
      textAlign: 'center',
    },
    entityToggleRow: {
      paddingTop: 0,
      paddingBottom: 0,
    },
    entityTitleWrap: {
      flex: 1,
      minWidth: 0,
      paddingRight: theme.spacing.sm,
    },
    entityToggleLabel: {
      color: theme.colors.text,
      fontWeight: theme.typography.weight.regular,
    },
    entityToggleLabelExpanded: {
      fontWeight: theme.typography.weight.semibold,
    },
    entityStatusText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs ?? theme.typography.sizes.sm,
      marginTop: theme.spacing.xxs ?? 2,
    },
    entityStatusError: {
      color: theme.colors.danger,
    },
    entityToggleChevron: {
      minWidth: theme.components?.listItem?.chevronTouchSize ?? 36,
      minHeight: theme.components?.listItem?.chevronTouchSize ?? 36,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: -theme.spacing.xs,
    },
    groupedFieldsWrap: {
      paddingLeft: theme.spacing.lg,
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
    fieldRow: {
      gap: theme.spacing.md,
      alignItems: 'center',
      paddingTop: 0,
      paddingBottom: 0,
    },
    fieldRowDisabled: {
      opacity: 0.48,
    },
    fieldTitle: {
      color: theme.colors.text,
    },
    fieldTitleDisabled: {
      color: theme.colors.textSecondary,
    },
    fieldTitleInput: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.medium,
      lineHeight: 20,
      paddingVertical: 0,
      minHeight: 20,
      maxHeight: 44,
      flex: 1,
      minWidth: 0,
      textAlignVertical: 'top',
    },
    fieldEditIconBtn: {
      width: 28,
      height: 28,
      borderRadius: theme.radii.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fieldEditIconBtnInline: {
      marginLeft: -(28 + (theme.spacing.xs ?? 4)),
      marginRight: theme.spacing.xs ?? 4,
    },
    fieldEditIconBtnPressed: {
      backgroundColor: theme.colors.cardBorder,
    },
    fieldSwitchCell: {
      width: switchColumnWidth,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyWrap: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.lg,
    },
    muted: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
  });
}


