import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import SectionHeader from '../ui/SectionHeader';
import TextField from '../ui/TextField';
import { BaseModal } from '../ui/modals';
import ModalActionsRow from '../ui/modals/ModalActionsRow';
import { FieldErrorText } from '../../src/shared/feedback';
import { getRequiredFieldLabel } from '../../src/shared/forms/fieldValidation';
import { useTranslation } from '../../src/i18n/useTranslation';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getOrderedEntityFields,
  getEntityFieldMap,
} from '../../src/features/fieldSettings/catalog';
import { useTheme } from '../../theme/ThemeProvider';
import {
  CLIENT_OBJECT_ADDITIONAL_INFO_FIELDS,
  CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS,
} from '../../src/features/objects/addressing';

const FIELD_LABEL_KEYS = {
  name: 'objects_field_name',
  country: 'order_field_country',
  region: 'order_field_region',
  district: 'order_field_district',
  city: 'order_field_city',
  street: 'order_field_street',
  house: 'order_field_house',
  postal_code: 'order_field_postal_code',
  office: 'order_field_office',
  floor: 'order_field_floor',
  entrance: 'order_field_entrance',
  apartment: 'order_field_apartment',
  entrance_info: 'order_field_entrance_info',
  parking_notes: 'order_field_parking_notes',
  geo_lat: 'order_field_geo_lat',
  geo_lng: 'order_field_geo_lng',
};

const FIELD_PLACEHOLDER_KEYS = {
  country: 'create_order_placeholder_country',
  region: 'create_order_placeholder_region',
  district: 'create_order_placeholder_district',
  city: 'create_order_placeholder_city',
  street: 'create_order_placeholder_street',
  house: 'create_order_placeholder_house',
  postal_code: 'create_order_placeholder_postal_code',
  office: 'create_order_placeholder_office',
  floor: 'create_order_placeholder_floor',
  entrance: 'create_order_placeholder_entrance',
  apartment: 'create_order_placeholder_apartment',
  entrance_info: 'create_order_placeholder_entrance_info',
  parking_notes: 'create_order_placeholder_parking_notes',
  geo_lat: 'create_order_placeholder_geo_lat',
  geo_lng: 'create_order_placeholder_geo_lng',
};

const NUMERIC_FIELDS = new Set(['geo_lat', 'geo_lng']);
const MULTILINE_FIELDS = new Set(['entrance_info', 'parking_notes']);

export default function ClientObjectEditorModal({
  visible,
  title,
  draft,
  fieldSettings = null,
  onChange,
  onSave,
  onClose,
  saving = false,
  fieldErrors = {},
  saveLabel = null,
  searchSuggestions = [],
  searchSuggestionsLoading = false,
  searchSuggestionsVisible = false,
  searchSuggestionsEmpty = false,
  onSelectSuggestion = null,
}) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const settings = React.useMemo(
    () => fieldSettings || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT),
    [fieldSettings],
  );
  const fieldsByKey = React.useMemo(() => getEntityFieldMap(settings), [settings]);
  const _visiblePrimaryFields = React.useMemo(
    () =>
      CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS.filter(
        (field) => fieldsByKey.get(field)?.isEnabled !== false,
      ),
    [fieldsByKey],
  );
  const _visibleAdditionalFields = React.useMemo(
    () =>
      CLIENT_OBJECT_ADDITIONAL_INFO_FIELDS.filter(
        (field) => fieldsByKey.get(field)?.isEnabled !== false,
      ),
    [fieldsByKey],
  );
  const orderedPrimaryFields = React.useMemo(
    () =>
      getOrderedEntityFields(settings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS,
      }).map((field) => field.fieldKey),
    [settings],
  );
  const orderedAdditionalFields = React.useMemo(
    () =>
      getOrderedEntityFields(settings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: CLIENT_OBJECT_ADDITIONAL_INFO_FIELDS,
      }).map((field) => field.fieldKey),
    [settings],
  );

  const withRequiredLabel = React.useCallback(
    (fieldKey, label) => getRequiredFieldLabel(label, fieldsByKey.get(fieldKey)?.isRequired === true),
    [fieldsByKey],
  );

  const footer = (
    <View style={styles.footer}>
      <ModalActionsRow
        actions={[
          {
            key: 'save',
            title: saveLabel || t('btn_save'),
            variant: 'primary',
            loading: saving,
            disabled: saving,
            onPress: onSave,
          },
        ]}
      />
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={title}
      footer={footer}
      maxHeightRatio={0.86}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <TextField
          label={withRequiredLabel('name', t(FIELD_LABEL_KEYS.name))}
          value={String(draft?.name || '')}
          onChangeText={(value) => onChange?.('name', value)}
          error={fieldErrors?.name ? 'invalid' : undefined}
          style={styles.field}
        />
        <FieldErrorText message={fieldErrors?.name || null} />
        {orderedPrimaryFields.map((field) => (
          <React.Fragment key={field}>
            <TextField
              label={withRequiredLabel(field, t(FIELD_LABEL_KEYS[field]))}
              placeholder={FIELD_PLACEHOLDER_KEYS[field] ? t(FIELD_PLACEHOLDER_KEYS[field]) : undefined}
              value={String(draft?.[field] || '')}
              onChangeText={(value) => onChange?.(field, value)}
              keyboardType={NUMERIC_FIELDS.has(field) ? 'decimal-pad' : undefined}
              multiline={MULTILINE_FIELDS.has(field)}
              minLines={MULTILINE_FIELDS.has(field) ? 2 : undefined}
              error={fieldErrors?.[field] ? 'invalid' : undefined}
              style={styles.field}
            />
            <FieldErrorText message={fieldErrors?.[field] || null} />
          </React.Fragment>
        ))}
        {searchSuggestionsVisible ? (
          <>
            <SectionHeader topSpacing="xs" bottomSpacing="xs">
              {t('order_object_search_title', 'Похожие объекты')}
            </SectionHeader>
            <Text style={styles.suggestionHint}>
              {t(
                'order_object_search_hint',
                'Если адрес уже есть в базе, лучше выбрать существующий объект, а не создавать дубль.',
              )}
            </Text>
            {searchSuggestionsLoading ? (
              <Text style={styles.suggestionStateText}>
                {t('order_object_search_loading', 'Ищем похожие объекты...')}
              </Text>
            ) : null}
            {!searchSuggestionsLoading && searchSuggestionsEmpty ? (
              <Text style={styles.suggestionStateText}>
                {t('order_object_search_empty', 'Совпадений пока не найдено')}
              </Text>
            ) : null}
            {!searchSuggestionsLoading
              ? searchSuggestions.map((item) => (
                  <Pressable
                    key={`${item.objectId}-${item.clientId}`}
                    style={({ pressed }) => [
                      styles.suggestionCard,
                      pressed ? styles.suggestionCardPressed : null,
                    ]}
                    onPress={() => onSelectSuggestion?.(item)}
                  >
                    <Text style={styles.suggestionTitle} numberOfLines={1}>
                      {item.objectName || t('objects_new')}
                    </Text>
                    <Text style={styles.suggestionSubtitle} numberOfLines={1}>
                      {item.shortAddress || t('order_details_address_not_specified')}
                    </Text>
                    <Text style={styles.suggestionMeta} numberOfLines={1}>
                      {item.clientName || t('routes_clients_client')}
                    </Text>
                  </Pressable>
                ))
              : null}
          </>
        ) : null}
        {orderedAdditionalFields.length ? (
          <>
            <SectionHeader topSpacing="xs" bottomSpacing="xs">
              {t('objects_additional_info_section')}
            </SectionHeader>
            {orderedAdditionalFields.map((field) => (
              <React.Fragment key={field}>
                <TextField
                  label={withRequiredLabel(field, t(FIELD_LABEL_KEYS[field]))}
                  placeholder={FIELD_PLACEHOLDER_KEYS[field] ? t(FIELD_PLACEHOLDER_KEYS[field]) : undefined}
                  value={String(draft?.[field] || '')}
                  onChangeText={(value) => onChange?.(field, value)}
                  keyboardType={NUMERIC_FIELDS.has(field) ? 'decimal-pad' : undefined}
                  multiline={MULTILINE_FIELDS.has(field)}
                  minLines={MULTILINE_FIELDS.has(field) ? 2 : undefined}
                  error={fieldErrors?.[field] ? 'invalid' : undefined}
                  style={styles.field}
                />
                <FieldErrorText message={fieldErrors?.[field] || null} />
              </React.Fragment>
            ))}
          </>
        ) : null}
      </ScrollView>
    </BaseModal>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    scroll: {
      width: '100%',
    },
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.md,
    },
    field: {
      marginBottom: theme.spacing.xs,
    },
    footer: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.md,
      paddingTop: theme.spacing.sm,
    },
    suggestionHint: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      marginBottom: theme.spacing.sm,
    },
    suggestionStateText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      marginBottom: theme.spacing.sm,
    },
    suggestionCard: {
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      marginBottom: theme.spacing.xs,
    },
    suggestionCardPressed: {
      opacity: 0.85,
    },
    suggestionTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
      marginBottom: 2,
    },
    suggestionSubtitle: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      marginBottom: 2,
    },
    suggestionMeta: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs ?? theme.typography.sizes.sm,
    },
  });
}
