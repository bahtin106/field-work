// src/shared/feedback/FieldErrorText.jsx
import { StyleSheet, Text } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';

export default function FieldErrorText({ message, style }) {
  const { theme } = useTheme();
  if (!message) return null;
  return <Text style={[styles(theme).text, style]}>{String(message)}</Text>;
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
