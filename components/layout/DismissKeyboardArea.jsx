import { Keyboard, TouchableWithoutFeedback, View } from 'react-native';

export default function DismissKeyboardArea({ children, style, enabled = true }) {
  if (!enabled) {
    return <View style={style}>{children}</View>;
  }

  return (
    <TouchableWithoutFeedback
      accessible={false}
      onPress={() => {
        try {
          Keyboard.dismiss();
        } catch {}
      }}
    >
      <View style={style}>{children}</View>
    </TouchableWithoutFeedback>
  );
}
