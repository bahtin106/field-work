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
      T('err_required_field', 'Obyazatelnoe pole'),
      T('err_email_invalid_format', 'Nekorrektnyi email'),
      T('err_phone', 'Telefon dolzhen byt v formate +7'),
      T('clients_required_any_name', 'Zapolnite hotya by odno pole imeni'),
      T('clients_required_phone', 'Ukazhite osnovnoi telefon klienta'),
      T('field_settings_required_fill', 'Zapolnite obyazatelnye polya'),
      T('order_validation_title_required', 'Ukazhite nazvanie zayavki'),
      T('order_validation_date_required', 'Ukazhite datu vyezda'),
      T('order_validation_executor_required', 'Vyberite ispolnitelya ili otpravte v lentu'),
      T('order_validation_work_type_required', 'Vyberite tip rabot'),
      T('order_validation_client_required', 'Vyberite klienta'),
      T('objects_select_required_for_order', 'Vyberite obyekt'),
      T('order_validation_phone_format', 'Vvedite korrektnyi nomer telefona'),
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );

  if (
    hiddenValidationMessages.has(raw) ||
    lower === 'обязательное поле' ||
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
