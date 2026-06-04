// src/shared/feedback/FieldErrorText.jsx
import { StyleSheet, Text } from 'react-native';
import { t as T } from '../../i18n';
import { useTheme } from '../../../theme/ThemeProvider';

export default function FieldErrorText({ message, style }) {
  const { theme } = useTheme();
  if (!message) return null;

  const raw = String(message).trim();
  const lower = raw.toLowerCase();
  const hiddenValidationMessages = new Set(
    [
      T('err_required_field'),
      T('err_email_invalid_format'),
      T('err_phone'),
      T('clients_required_any_name'),
      T('clients_required_phone'),
      T('field_settings_required_fill'),
      T('order_validation_title_required'),
      T('order_validation_date_required'),
      T('order_validation_executor_required'),
      T('order_validation_work_type_required'),
      T('order_validation_client_required'),
      T('objects_select_required_for_order'),
      T('order_validation_phone_format'),
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );

  if (
    hiddenValidationMessages.has(raw) ||
    lower === 'required field'
  ) {
    return null;
  }

  return <Text style={[styles(theme).text, style]}>{raw}</Text>;
}

const styles = (theme) =>
  StyleSheet.create({
    text: {
      marginTop: 4,
      marginLeft: theme.spacing?.lg ?? 16,
      marginRight: theme.spacing?.lg ?? 16,
      color: theme.colors.danger,
      fontSize: theme.typography.sizes.xs,
      fontWeight: '500',
    },
  });
