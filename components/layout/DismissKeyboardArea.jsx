import { Keyboard, View } from 'react-native';

export default function DismissKeyboardArea({ children, style, enabled = true }) {
  if (!enabled) {
    return <View style={style}>{children}</View>;
  }

  return (
    <View
      style={style}
      onTouchEnd={(event) => {
        // Dismiss only when the background View itself was tapped. A passive
        // touch listener does not become the responder, so ScrollViews retain
        // ownership of drag gestures and inputs keep their focus taps.
        if (event?.target !== event?.currentTarget) return;
        try {
          Keyboard.dismiss();
        } catch {}
      }}
    >
      {children}
    </View>
  );
}
