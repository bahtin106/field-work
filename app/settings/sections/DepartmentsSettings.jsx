// app/settings/sections/DepartmentsSettings.jsx
// Placeholder screen for configuring company departments.
//
// This screen currently shows a placeholder message to indicate that
// department management is planned.  When you are ready to implement
// department creation and editing, replace the content of this file with
// appropriate inputs and logic.

import React from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from 'expo-router';
import { useRoute } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import Screen from '../../../components/layout/Screen';

export default function DepartmentsSettings() {
  const nav = useNavigation();
  const route = useRoute();
  const { theme } = useTheme();

  React.useLayoutEffect(() => {
    try {
      nav?.setParams?.({ title: 'Отделы', headerTitle: 'Отделы' });
    } catch (e) {
      // ignore
    }
  }, [nav, route?.key]);

  return (
    <Screen background="background" edges={['top', 'bottom']}>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: theme?.spacing?.md ?? 16,
        }}
      >
        <Text
          style={{
            ...(theme?.typography?.body ?? {}),
            color: theme?.colors?.text ?? (theme?.colors?.onSurface ?? '#000'),
            textAlign: 'center',
          }}
        >
          Эта страница находится в разработке.
        </Text>
      </View>
    </Screen>
  );
}