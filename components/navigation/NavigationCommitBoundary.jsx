import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';

/**
 * Lets the navigator commit the destination scene before rendering a heavy
 * screen subtree. Without this boundary, mounting a large screen can block the
 * JS thread and keep the previous route visible until the whole render ends.
 */
function NavigationCommitBoundary({ children }) {
  const { theme } = useTheme();
  const [contentReady, setContentReady] = React.useState(false);

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setContentReady(true);
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  if (contentReady) return children;

  return (
    <View
      pointerEvents="none"
      style={[styles.placeholder, { backgroundColor: theme.colors.background }]}
    >
      <ActivityIndicator size="small" color={theme.colors.primary} />
    </View>
  );
}

export function renderNavigationScreen({ children }) {
  return <NavigationCommitBoundary>{children}</NavigationCommitBoundary>;
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
