import { useMemo } from 'react';
import { router } from 'expo-router';
import { View, Text,  StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/ui/Button';

import { useTheme } from '../../theme/ThemeProvider';

export default function OrderSuccessScreen() {
  const { theme } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          justifyContent: 'center',
          padding: 24,
          backgroundColor: theme.colors.bg,
        },
        messageBox: {
          backgroundColor: theme.colors.card,
          padding: 32,
          borderRadius: 12,
          shadowColor: '#000',
          shadowOpacity: 0.1,
          shadowRadius: 10,
          elevation: 4,
        },
        successText: {
          fontSize: 20,
          fontWeight: 'bold',
          marginBottom: 20,
          textAlign: 'center',
          color: theme.colors.success,
        },
      }),
    [theme],
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.messageBox}>
        <Text style={styles.successText}>Заявка успешно создана</Text>
        <Button title="На главную" onPress={() => router.replace('/')} />
      </View>
    </SafeAreaView>
  );
}
