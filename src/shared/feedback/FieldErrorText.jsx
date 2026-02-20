// src/shared/feedback/FieldErrorText.jsx
import { StyleSheet, Text } from 'react-native';
import { t as T } from '../../i18n';
import { useTheme } from '../../../theme/ThemeProvider';

export default function FieldErrorText({ message, style }) {
  const { theme } = useTheme();
  if (!message) return null;
  const raw = String(message).trim();
  const requiredLabel = String(T('err_required_field', 'Обязательное поле')).trim();
  const lower = raw.toLowerCase();
  if (raw === requiredLabel || lower === 'обязательное поле' || lower === 'required field') {
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
