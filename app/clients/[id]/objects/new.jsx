import React from 'react';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import AdditionalPhoneInputRow from '../../../../components/clients/AdditionalPhoneInputRow';
import EditScreenTemplate from '../../../../components/layout/EditScreenTemplate';
import Card from '../../../../components/ui/Card';
import SectionHeader from '../../../../components/ui/SectionHeader';
import TextField from '../../../../components/ui/TextField';
import { useToast } from '../../../../components/ui/ToastProvider';
import TagEditorField from '../../../../components/tags/TagEditorField';
import { TAG_TYPE } from '../../../../components/tags/tagConfig';
import { useCompanySettings } from '../../../../hooks/useCompanySettings';
import { usePermissions } from '../../../../lib/permissions';
import { FieldErrorText, FEEDBACK_CODES, getMessageByCode } from '../../../../src/shared/feedback';
import { getRequiredFieldLabel } from '../../../../src/shared/forms/fieldValidation';
import { useClient } from '../../../../src/features/clients/queries';
import { useCreateClientObjectMutation } from '../../../../src/features/objects/queries';
import { useEntityFieldSettings } from '../../../../src/features/fieldSettings/queries';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getOrderedEntityFields,
  getEntityFieldMap,
} from '../../../../src/features/fieldSettings/catalog';
import { useSetObjectTagsMutation } from '../../../../src/features/tags/queries';
import {
  CLIENT_OBJECT_ADDRESS_FIELDS,
  createEmptyClientObjectDraft,
  hasClientObjectMapPoint,
  normalizeClientObjectLocationMode,
  normalizeCoordinateValue,
  sanitizeClientObjectPayload,
} from '../../../../src/features/objects/addressing';
import {
  buildObjectAdditionalPhonesPatch,
  createEmptyAdditionalObjectPhones,
  getAddableAdditionalObjectPhoneSlotIds,
  getVisibleAdditionalObjectPhoneSlotIds,
  OBJECT_ADDITIONAL_PHONE_SLOT_COUNT,
  resolveVisibleAdditionalObjectPhoneSlotIds,
} from '../../../../src/features/objects/additionalPhones';
import { useTranslation } from '../../../../src/i18n/useTranslation';
import { hasDisplayValue } from '../../../../src/shared/display/value';
import { getRequiredTextFieldError } from '../../../../src/shared/validation/fields';
import { hasMobilePhoneValue, isValidOptionalMobilePhone } from '../../../../src/shared/validation/phone';
import { useTheme } from '../../../../theme/ThemeProvider';

function parseCoordinatesFromText(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const text = raw.replace(/,/g, '.');
  const matches = text.match(/-?\d+(?:\.\d+)?/g) || [];
  if (matches.length < 2) return null;
  const first = Number(matches[0]);
  const second = Number(matches[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  const inLatRange = (value) => value >= -90 && value <= 90;
  const inLngRange = (value) => value >= -180 && value <= 180;
  let lat = first;
  let lng = second;
  if (!inLatRange(lat) || !inLngRange(lng)) {
    lat = second;
    lng = first;
  }
  if (!inLatRange(lat) || !inLngRange(lng)) return null;
  return {
    lat: normalizeCoordinateValue(lat),
    lng: normalizeCoordinateValue(lng),
  };
}

export default function NewClientObjectScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const navigation = useNavigation();
  const { has } = usePermissions();
  const { id } = useLocalSearchParams();
  const clientId = Array.isArray(id) ? id[0] : id;

  const canCreateObjects = has('canCreateObjects');
  const canViewClients = has('canViewClients');
  const { data: client } = useClient(clientId, { enabled: !!clientId && canViewClients });
  const { settings } = useCompanySettings();
  const { data: objectFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT, {
    enabled: !!clientId,
  });
  const createMutation = useCreateClientObjectMutation();
  const setObjectTagsMutation = useSetObjectTagsMutation();
  const [draft, setDraft] = React.useState(createEmptyClientObjectDraft());
  const [additionalPhones, setAdditionalPhones] = React.useState(createEmptyAdditionalObjectPhones());
  const [visibleAdditionalPhoneSlots, setVisibleAdditionalPhoneSlots] = React.useState([]);
  const [tags, setTags] = React.useState([]);
  const [locationMode, setLocationMode] = React.useState('address');
  const [clipboardHasCoordinates, setClipboardHasCoordinates] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState({});
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const objectFieldSettings = React.useMemo(
    () => objectFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT),
    [objectFieldSettingsData],
  );
  const objectFieldsByKey = React.useMemo(() => getEntityFieldMap(objectFieldSettings), [objectFieldSettings]);
  const visibleAddressFields = React.useMemo(
    () => CLIENT_OBJECT_ADDRESS_FIELDS.filter((field) => objectFieldsByKey.get(field)?.isEnabled === true),
    [objectFieldsByKey],
  );
  const orderedAddressFields = React.useMemo(
    () =>
      getOrderedEntityFields(objectFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: CLIENT_OBJECT_ADDRESS_FIELDS,
      }).map((field) => field.fieldKey),
    [objectFieldSettings],
  );
  const enabledAdditionalPhoneSlots = React.useMemo(
    () => [1, 2, 3].filter((slotId) => objectFieldsByKey.get(`additional_phone_${slotId}`)?.isEnabled === true),
    [objectFieldsByKey],
  );
  const requiredAdditionalPhoneSlots = React.useMemo(
    () => [1, 2, 3].filter((slotId) => objectFieldsByKey.get(`additional_phone_${slotId}`)?.isRequired === true),
    [objectFieldsByKey],
  );
  const addableAdditionalPhoneSlots = React.useMemo(
    () => getAddableAdditionalObjectPhoneSlotIds(enabledAdditionalPhoneSlots, requiredAdditionalPhoneSlots),
    [enabledAdditionalPhoneSlots, requiredAdditionalPhoneSlots],
  );
  const orderedContactFieldKeys = React.useMemo(
    () =>
      getOrderedEntityFields(objectFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: ['additional_phone_1', 'additional_phone_2', 'additional_phone_3'],
      }).map((field) => field.fieldKey),
    [objectFieldSettings],
  );
  const canShowContactSection = orderedContactFieldKeys.length > 0;
  const mapLat = React.useMemo(() => normalizeCoordinateValue(draft?.geo_lat), [draft?.geo_lat]);
  const mapLng = React.useMemo(() => normalizeCoordinateValue(draft?.geo_lng), [draft?.geo_lng]);
  const hasMapPoint = React.useMemo(() => hasClientObjectMapPoint(draft), [draft]);
  const withRequiredLabel = React.useCallback(
    (field, label) => getRequiredFieldLabel(label, objectFieldsByKey.get(field)?.isRequired === true),
    [objectFieldsByKey],
  );
  const updateAdditionalPhoneBySlotId = React.useCallback((slotId, patch) => {
    const slotIndex = Number(slotId) - 1;
    if (!Number.isFinite(slotIndex) || slotIndex < 0) return;
    setAdditionalPhones((prev) =>
      prev.map((item, itemIndex) => (itemIndex === slotIndex ? { ...item, ...patch } : item)),
    );
  }, []);
  const hiddenEnabledAdditionalPhoneSlots = React.useMemo(
    () => addableAdditionalPhoneSlots.filter((slotId) => !visibleAdditionalPhoneSlots.includes(slotId)),
    [addableAdditionalPhoneSlots, visibleAdditionalPhoneSlots],
  );
  const canAddAdditionalPhone =
    hiddenEnabledAdditionalPhoneSlots.length > 0 &&
    visibleAdditionalPhoneSlots.length < OBJECT_ADDITIONAL_PHONE_SLOT_COUNT;

  React.useEffect(() => {
    setLocationMode(
      normalizeClientObjectLocationMode(draft?.location_mode, {
        fallback: hasMapPoint ? 'map' : 'address',
      }),
    );
  }, [draft?.location_mode, hasMapPoint]);

  React.useEffect(() => {
    if (locationMode !== 'map') {
      setClipboardHasCoordinates(false);
      return undefined;
    }
    let disposed = false;
    const checkClipboard = async () => {
      try {
        const value = await Clipboard.getStringAsync();
        if (!disposed) setClipboardHasCoordinates(!!parseCoordinatesFromText(value));
      } catch {
        if (!disposed) setClipboardHasCoordinates(false);
      }
    };
    checkClipboard();
    const timer = setInterval(checkClipboard, theme.timing?.clipboardPollMs ?? 1200);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [locationMode, theme.timing?.clipboardPollMs]);

  React.useEffect(() => {
    setVisibleAdditionalPhoneSlots((prev) =>
      resolveVisibleAdditionalObjectPhoneSlotIds({
        enabledSlotIds: enabledAdditionalPhoneSlots,
        requiredSlotIds: requiredAdditionalPhoneSlots,
        explicitVisibleSlotIds: prev,
        valueVisibleSlotIds: getVisibleAdditionalObjectPhoneSlotIds(additionalPhones),
      }),
    );
  }, [additionalPhones, enabledAdditionalPhoneSlots, requiredAdditionalPhoneSlots]);

  const saveObject = React.useCallback(async () => {
    if (!clientId || !canCreateObjects || saving) return;
    const normalizedLocationMode = normalizeClientObjectLocationMode(locationMode, {
      fallback: hasMapPoint ? 'map' : 'address',
    });
    const nextFieldErrors = ['name', ...visibleAddressFields].reduce((acc, field) => {
      const shouldRelaxRequired =
        normalizedLocationMode === 'map' && hasMapPoint && CLIENT_OBJECT_ADDRESS_FIELDS.includes(field);
      const message = getRequiredTextFieldError(draft?.[field], {
        required: shouldRelaxRequired ? false : objectFieldsByKey.get(field)?.isRequired === true,
        requiredMessage: getMessageByCode(FEEDBACK_CODES.REQUIRED_FIELD, t),
      });
      if (!message) return acc;
      return { ...acc, [field]: message };
    }, {});
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }
    const firstInvalidAdditional = visibleAdditionalPhoneSlots.find((slotId) => {
      const slotIndex = Number(slotId) - 1;
      const value = additionalPhones?.[slotIndex]?.phone || '';
      if (requiredAdditionalPhoneSlots.includes(slotId) && !hasMobilePhoneValue(value)) return true;
      return hasMobilePhoneValue(value) && !isValidOptionalMobilePhone(value);
    });
    if (firstInvalidAdditional) {
      setFieldErrors((prev) => ({ ...prev, [`additional_phone_${firstInvalidAdditional}`]: t('err_phone') }));
      return;
    }
    setSaving(true);
    try {
      const created = await createMutation.mutateAsync({
        client_id: String(clientId),
        ...sanitizeClientObjectPayload(draft),
        geo_lat: mapLat || null,
        geo_lng: mapLng || null,
        location_mode: normalizedLocationMode,
        ...buildObjectAdditionalPhonesPatch(additionalPhones, {
          defaultLabel: t('order_field_secondary_phone'),
          visibleSlotIds: visibleAdditionalPhoneSlots,
        }),
      });

      if (settings?.enable_object_tags && tags.length > 0) {
        await setObjectTagsMutation.mutateAsync({
          objectId: String(created.id),
          tags,
        });
      }

      toast.success(t('objects_saved'));
      router.replace(`/objects/${created.id}`);
    } catch (error) {
      toast.error(error?.message || t('clients_save_failed'));
    } finally {
      setSaving(false);
    }
  }, [additionalPhones, canCreateObjects, clientId, createMutation, draft, hasMapPoint, locationMode, mapLat, mapLng, objectFieldsByKey, requiredAdditionalPhoneSlots, router, saving, setObjectTagsMutation, settings?.enable_object_tags, t, tags, toast, visibleAddressFields, visibleAdditionalPhoneSlots]);

  const setNextLocationMode = React.useCallback((nextMode) => {
    const normalized = normalizeClientObjectLocationMode(nextMode);
    setLocationMode(normalized);
    setDraft((prev) => ({ ...prev, location_mode: normalized }));
  }, []);

  const openMapForPoint = React.useCallback(async () => {
    try {
      if (hasMapPoint) {
        const query = `${mapLat}, ${mapLng}`;
        await Linking.openURL(`yandexnavi://map_search?text=${encodeURIComponent(query)}`);
      } else {
        await Linking.openURL('yandexnavi://map_search?text=');
      }
    } catch {
      try {
        await Linking.openURL('https://yandex.ru/maps/');
      } catch {}
    }
  }, [hasMapPoint, mapLat, mapLng]);

  const pasteCoordinatesFromClipboard = React.useCallback(async () => {
    if (!clipboardHasCoordinates) return;
    try {
      const value = await Clipboard.getStringAsync();
      const parsed = parseCoordinatesFromText(value);
      if (!parsed) return;
      setDraft((prev) => ({ ...prev, geo_lat: parsed.lat, geo_lng: parsed.lng, location_mode: 'map' }));
      setLocationMode('map');
    } catch {}
  }, [clipboardHasCoordinates]);

  const clearMapPoint = React.useCallback(() => {
    setDraft((prev) => ({ ...prev, geo_lat: '', geo_lng: '' }));
  }, []);

  if (!canCreateObjects) {
    return (
      <EditScreenTemplate title={t('routes_objects_new')}>
        <View style={styles.blockedWrap}>
          <Text style={styles.blockedText}>{t('objects_no_create_permission')}</Text>
        </View>
      </EditScreenTemplate>
    );
  }

  return (
    <EditScreenTemplate
      title={t('routes_objects_new')}
      rightTextLabel={saving ? t('toast_saving') : t('btn_create')}
      onRightPress={saveObject}
      onBack={() => navigation.goBack()}
    >
      <Card style={styles.headerCard}>
        {hasDisplayValue(client?.fullName) ? (
          <Text style={styles.nameTitle}>{client.fullName}</Text>
        ) : null}
        <Text style={styles.clientName}>{t('routes_clients_client')}</Text>
      </Card>

      <SectionHeader topSpacing="xs">{t('section_personal')}</SectionHeader>
      <Card paddedXOnly>
        <TextField
          label={withRequiredLabel('name', t('objects_field_name'))}
          value={draft.name}
          onChangeText={(value) => {
            setDraft((prev) => ({ ...prev, name: value }));
            setFieldErrors((prev) => (prev?.name ? { ...prev, name: null } : prev));
          }}
          error={fieldErrors?.name ? 'invalid' : undefined}
          style={styles.field}
        />
        <FieldErrorText message={fieldErrors?.name || null} />
      </Card>

      <SectionHeader topSpacing="xs">{t('objects_address_section')}</SectionHeader>
      <Card paddedXOnly>
        <View style={styles.locationModeRow}>
          <Pressable
            onPress={() => setNextLocationMode('address')}
            style={[styles.locationModeBtn, locationMode === 'address' ? styles.locationModeBtnActive : null]}
          >
            <Text style={[styles.locationModeBtnText, locationMode === 'address' ? styles.locationModeBtnTextActive : null]}>
              {t('objects_location_mode_address')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setNextLocationMode('map')}
            style={[styles.locationModeBtn, locationMode === 'map' ? styles.locationModeBtnActive : null]}
          >
            <Text style={[styles.locationModeBtnText, locationMode === 'map' ? styles.locationModeBtnTextActive : null]}>
              {t('objects_location_mode_map')}
            </Text>
          </Pressable>
        </View>
        {locationMode === 'map' ? (
          <View style={styles.mapPointBlock}>
            <Text style={styles.mapPointHint}>{t('objects_location_map_hint')}</Text>
            <View style={styles.mapPointValueRow}>
              <Text style={styles.mapPointValue}>{hasMapPoint ? `${mapLat}, ${mapLng}` : t('objects_location_empty')}</Text>
              {hasMapPoint ? (
                <Pressable onPress={clearMapPoint} style={styles.mapPointClearBtn}>
                  <Feather name="x-circle" size={theme.icons?.sm ?? 18} color={theme.colors.textSecondary} />
                </Pressable>
              ) : null}
            </View>
            <View style={styles.mapActionsRow}>
              <Pressable onPress={openMapForPoint} style={styles.mapActionBtn}>
                <Text style={styles.mapActionBtnText}>{t('objects_location_open_map')}</Text>
              </Pressable>
              <Pressable
                onPress={pasteCoordinatesFromClipboard}
                style={[styles.mapActionBtn, !clipboardHasCoordinates ? styles.mapActionBtnInactive : null]}
                disabled={!clipboardHasCoordinates}
              >
                <Text style={styles.mapActionBtnText}>{t('objects_location_paste')}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {locationMode === 'address'
          ? orderedAddressFields.map((field) => (
              <React.Fragment key={field}>
                <TextField
                  label={withRequiredLabel(field, t(`order_field_${field}`))}
                  value={String(draft[field] || '')}
                  onChangeText={(value) => {
                    setDraft((prev) => ({ ...prev, [field]: value }));
                    setFieldErrors((prev) => (prev?.[field] ? { ...prev, [field]: null } : prev));
                  }}
                  error={fieldErrors?.[field] ? 'invalid' : undefined}
                  style={styles.field}
                />
                <FieldErrorText message={fieldErrors?.[field] || null} />
              </React.Fragment>
            ))
          : null}
        {settings?.enable_object_tags ? (
          <TagEditorField
            label={t('tags_field_label')}
            tagType={TAG_TYPE.OBJECT}
            tags={tags}
            onChange={setTags}
            placeholder={t('tags_input_placeholder')}
          />
        ) : null}
      </Card>
      {canShowContactSection ? <SectionHeader topSpacing="xs">{t('clients_contacts_section')}</SectionHeader> : null}
      {canShowContactSection ? (
        <Card paddedXOnly>
          {visibleAdditionalPhoneSlots.filter((slotId) => orderedContactFieldKeys.includes(`additional_phone_${slotId}`)).map((slotId) => {
            const slotIndex = slotId - 1;
            const entry = additionalPhones[slotIndex] || { phone: '', label: '' };
            return (
              <AdditionalPhoneInputRow
                key={`additional-phone-${slotId}`}
                phoneValue={entry.phone || ''}
                onPhoneChange={(nextValue) => {
                  updateAdditionalPhoneBySlotId(slotId, { phone: nextValue });
                  setFieldErrors((prev) => ({ ...prev, [`additional_phone_${slotId}`]: null }));
                }}
                designationValue={entry.label || ''}
                onDesignationChange={(nextValue) => updateAdditionalPhoneBySlotId(slotId, { label: nextValue })}
                phoneRequired={requiredAdditionalPhoneSlots.includes(slotId)}
                phoneError={
                  fieldErrors?.[`additional_phone_${slotId}`] ||
                  (requiredAdditionalPhoneSlots.includes(slotId) && !hasMobilePhoneValue(entry.phone || '')
                    ? t('clients_required_phone')
                    : hasMobilePhoneValue(entry.phone || '') && !isValidOptionalMobilePhone(entry.phone || '')
                      ? t('err_phone')
                      : null)
                }
                onRemove={requiredAdditionalPhoneSlots.includes(slotId) ? undefined : () => {
                  setVisibleAdditionalPhoneSlots((prev) => prev.filter((value) => value !== slotId));
                }}
                style={styles.additionalPhoneGroup}
              />
            );
          })}
          {canAddAdditionalPhone ? (
            <View style={styles.additionalPhoneAddRow}>
              <Text style={styles.additionalPhoneAddText}>{t('clients_additional_phone_add')}</Text>
              <Pressable
                onPress={() => {
                  const nextSlotId = hiddenEnabledAdditionalPhoneSlots[0] || null;
                  if (!nextSlotId) return;
                  setVisibleAdditionalPhoneSlots((prev) => [...prev, nextSlotId].sort((a, b) => a - b));
                }}
                style={styles.additionalPhoneAddButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t('clients_additional_phone_a11y_add')}
              >
                <Feather
                  name="plus"
                  size={theme.components?.icon?.sizeXs ?? Math.round((theme.icons?.sm ?? 18) * 0.75)}
                  color={theme.colors.textSecondary}
                />
              </Pressable>
            </View>
          ) : null}
        </Card>
      ) : null}
    </EditScreenTemplate>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    blockedWrap: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    blockedText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    headerCard: {
      marginBottom: theme.spacing.md,
    },
    nameTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    clientName: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.sm,
      marginTop: theme.spacing.xs,
    },
    field: {
      marginVertical: theme.spacing.xs,
    },
    locationModeRow: {
      flexDirection: 'row',
      gap: theme.spacing.xs,
      paddingVertical: theme.spacing.xs,
    },
    locationModeBtn: {
      flex: 1,
      minHeight: 36,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.sm,
      backgroundColor: theme.colors.surface,
    },
    locationModeBtnActive: {
      borderColor: theme.colors.primary,
      backgroundColor: `${theme.colors.primary}1A`,
    },
    locationModeBtnText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    locationModeBtnTextActive: {
      color: theme.colors.primary,
    },
    mapPointBlock: {
      paddingVertical: theme.spacing.xs,
      marginBottom: theme.spacing.xs,
      gap: theme.spacing.sm,
    },
    mapPointHint: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    mapPointValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    mapPointValue: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.medium,
      flex: 1,
    },
    mapPointClearBtn: {
      minWidth: 24,
      minHeight: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mapActionsRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    mapActionBtn: {
      flex: 1,
      minHeight: 36,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.spacing.sm,
    },
    mapActionBtnInactive: {
      opacity: 0.5,
    },
    mapActionBtnText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    additionalPhoneGroup: {
      marginBottom: theme.spacing.xs,
    },
    additionalPhoneAddRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Number(theme.spacing?.lg ?? 16),
      paddingVertical: theme.spacing.xs,
      marginBottom: theme.spacing.xs,
    },
    additionalPhoneAddText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    additionalPhoneAddButton: {
      minWidth: 24,
      minHeight: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
