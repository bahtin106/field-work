import { useState, useEffect } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

/**
 * Mounts heavy children after the first committed frame.
 * Stack transitions are disabled in this app, so waiting for InteractionManager
 * only adds visible latency before the target screen becomes useful.
 */
export default function DeferredScreen({ children, style, placeholder = null }) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      setIsReady(true);
    });
    return () => {
      try {
        cancelAnimationFrame(rafId);
      } catch {}
    };
  }, []);

  if (!isReady) {
    if (placeholder) return placeholder;
    return (
      <View style={[styles.container, style]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <>{children}</>;
}
