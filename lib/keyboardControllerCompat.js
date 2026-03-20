import Constants from 'expo-constants';
import { Platform, ScrollView } from 'react-native';

let keyboardControllerModule = null;

const isExpoGo = Constants?.appOwnership === 'expo';

const canUseKeyboardController = !isExpoGo && Platform.OS === 'ios';

if (canUseKeyboardController) {
  try {
    keyboardControllerModule = require('react-native-keyboard-controller');
  } catch {
    keyboardControllerModule = null;
  }
}

export const KeyboardProvider =
  keyboardControllerModule?.KeyboardProvider || (({ children }) => children);

export const KeyboardAwareScrollView =
  keyboardControllerModule?.KeyboardAwareScrollView || ScrollView;
