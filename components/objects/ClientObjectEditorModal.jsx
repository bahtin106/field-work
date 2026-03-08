import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import UIButton from '../ui/Button';
import SectionHeader from '../ui/SectionHeader';
import TextField from '../ui/TextField';
import { BaseModal } from '../ui/modals';
import { useTranslation } from '../../src/i18n/useTranslation';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
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
  saveLabel = null,
}) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const settings = React.useMemo(
    () => fieldSettings || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT),
    [fieldSettings],
  );
  const fieldsByKey = React.useMemo(() => getEntityFieldMap(settings), [settings]);
  const visiblePrimaryFields = React.useMemo(
    () =>
      CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS.filter(
        (field) => fieldsByKey.get(field)?.isEnabled !== false,
      ),
    [fieldsByKey],
  );
  const visibleAdditionalFields = React.useMemo(
    () =>
      CLIENT_OBJECT_ADDITIONAL_INFO_FIELDS.filter(
        (field) => fieldsByKey.get(field)?.isEnabled !== false,
      ),
    [fieldsByKey],
  );

  const withRequiredLabel = React.useCallback(
    (fieldKey, label) => {
      if (fieldsByKey.get(fieldKey)?.isRequired !== true) return label;
      if (String(label || '').includes('*')) return label;
      return `${label} *`;
    },
    [fieldsByKey],
  );

  const footer = (
    <View style={styles.footer}>
      <UIButton
        title={saveLabel || t('btn_save')}
        onPress={onSave}
        disabled={saving}
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
          style={styles.field}
        />
        {visiblePrimaryFields.map((field) => (
          <TextField
            key={field}
            label={withRequiredLabel(field, t(FIELD_LABEL_KEYS[field]))}
            placeholder={FIELD_PLACEHOLDER_KEYS[field] ? t(FIELD_PLACEHOLDER_KEYS[field]) : undefined}
            value={String(draft?.[field] || '')}
            onChangeText={(value) => onChange?.(field, value)}
            keyboardType={NUMERIC_FIELDS.has(field) ? 'decimal-pad' : undefined}
            multiline={MULTILINE_FIELDS.has(field)}
            minLines={MULTILINE_FIELDS.has(field) ? 2 : undefined}
            style={styles.field}
          />
        ))}
        {visibleAdditionalFields.length ? (
          <>
            <SectionHeader topSpacing="xs" bottomSpacing="xs">
              {t('objects_additional_info_section')}
            </SectionHeader>
            {visibleAdditionalFields.map((field) => (
              <TextField
                key={field}
                label={withRequiredLabel(field, t(FIELD_LABEL_KEYS[field]))}
                placeholder={FIELD_PLACEHOLDER_KEYS[field] ? t(FIELD_PLACEHOLDER_KEYS[field]) : undefined}
                value={String(draft?.[field] || '')}
                onChangeText={(value) => onChange?.(field, value)}
                keyboardType={NUMERIC_FIELDS.has(field) ? 'decimal-pad' : undefined}
                multiline={MULTILINE_FIELDS.has(field)}
                minLines={MULTILINE_FIELDS.has(field) ? 2 : undefined}
                style={styles.field}
              />
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
  });
}
