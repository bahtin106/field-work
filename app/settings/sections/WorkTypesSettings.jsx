// app/settings/sections/WorkTypesSettings.jsx
// Placeholder screen for configuring work types.
//
// At the moment this page contains only a simple placeholder message.
// Future releases should replace this component with real functionality for
// managing different types of work performed by company employees.

import React from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from 'expo-router';
import { useRoute } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import Screen from '../../../components/layout/Screen';

export default function WorkTypesSettings() {
  const nav = useNavigation();
  const route = useRoute();
  const { theme } = useTheme();

  React.useLayoutEffect(() => {
    try {
      nav?.setParams?.({ title: 'Виды работ', headerTitle: 'Виды работ' });
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