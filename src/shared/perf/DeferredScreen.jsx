import { useState, useEffect } from 'react';
import { InteractionManager, ActivityIndicator, View, StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

/**
 * Delays mounting of children until after navigation interactions complete.
 * This makes screen transitions instant by rendering a lightweight placeholder
 * first, then mounting the heavy content after the native transition finishes.
 */
export default function DeferredScreen({ children, style, placeholder = null }) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        setIsReady(true);
      });
    });
    return () => task.cancel();
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
