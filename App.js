import Router from 'expo-router';
import { Keyboard, TextInput, View } from 'react-native';
import { useAppLastSeen } from './useAppLastSeen';

export default function App() {
  useAppLastSeen(); // touch profiles.last_seen_at on start/foreground
  return (
    <View
      style={{ flex: 1 }}
      // Capture phase responder: decide whether to dismiss keyboard before children handle touches
      onStartShouldSetResponderCapture={(e) => {
        try {
          // If there's no focused input, nothing to do
          const currentlyFocused =
            TextInput.State && typeof TextInput.State.currentlyFocusedInput === 'function'
              ? TextInput.State.currentlyFocusedInput()
              : null;
          if (!currentlyFocused) return false;
          // If the touch target is the currently focused input — don't dismiss
          const target = e?.nativeEvent?.target;
          if (target && currentlyFocused === target) return false;
          // Otherwise dismiss keyboard (user tapped outside)
          Keyboard.dismiss();
        } catch {}
        return false;
      }}
    >
      <Router />
    </View>
  );
}
