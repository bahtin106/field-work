import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import TextField from '../ui/TextField';
import { BaseModal } from '../ui/modals';
import ModalActionsRow from '../ui/modals/ModalActionsRow';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';
import { CLIENT_ADDRESS_FIELDS } from '../../src/features/clients/addressing';

const FIELD_LABEL_KEYS = {
  label: 'clients_address_label',
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

export default function ClientAddressEditorModal({
  visible,
  title,
  draft,
  onChange,
  onSave,
  onClose,
  saving = false,
  saveLabel = null,
}) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

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
          label={t(FIELD_LABEL_KEYS.label)}
          value={String(draft?.label || '')}
          onChangeText={(value) => onChange?.('label', value)}
          style={styles.field}
        />
        {CLIENT_ADDRESS_FIELDS.map((field) => (
          <TextField
            key={field}
            label={t(FIELD_LABEL_KEYS[field])}
            placeholder={FIELD_PLACEHOLDER_KEYS[field] ? t(FIELD_PLACEHOLDER_KEYS[field]) : undefined}
            value={String(draft?.[field] || '')}
            onChangeText={(value) => onChange?.(field, value)}
            keyboardType={NUMERIC_FIELDS.has(field) ? 'decimal-pad' : undefined}
            multiline={MULTILINE_FIELDS.has(field)}
            minLines={MULTILINE_FIELDS.has(field) ? 2 : undefined}
            style={styles.field}
          />
        ))}
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
