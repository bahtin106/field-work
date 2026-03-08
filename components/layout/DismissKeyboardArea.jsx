import { Keyboard, View } from 'react-native';

export default function DismissKeyboardArea({ children, style, enabled = true }) {
  if (!enabled) {
    return <View style={style}>{children}</View>;
  }

  return (
    <View
      style={style}
      onStartShouldSetResponderCapture={(event) => {
        try {
          return event?.target === event?.currentTarget;
        } catch {
          return false;
        }
      }}
      onResponderRelease={() => {
        try {
          Keyboard.dismiss();
        } catch {}
      }}
    >
      {children}
    </View>
  );
}
