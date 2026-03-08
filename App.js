import Router from 'expo-router';
import { findNodeHandle, Keyboard, TextInput, View } from 'react-native';
import { useAppLastSeen } from './useAppLastSeen';

function getFocusedInputHandle() {
  try {
    const byInput =
      TextInput.State && typeof TextInput.State.currentlyFocusedInput === 'function'
        ? TextInput.State.currentlyFocusedInput()
        : null;
    if (byInput) {
      const handle = findNodeHandle(byInput);
      if (handle) return handle;
    }
    const byField =
      TextInput.State && typeof TextInput.State.currentlyFocusedField === 'function'
        ? TextInput.State.currentlyFocusedField()
        : null;
    return byField || null;
  } catch {
    return null;
  }
}

export default function App() {
  useAppLastSeen(); // touch profiles.last_seen_at on start/foreground

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={(e) => {
        try {
          const focusedHandle = getFocusedInputHandle();
          if (!focusedHandle) return false;

          const target = e?.nativeEvent?.target;
          if (target && target === focusedHandle) return false;

          Keyboard.dismiss();
        } catch {}
        return false;
      }}
    >
      <Router />
    </View>
  );
}
