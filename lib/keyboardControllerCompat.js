import Constants from 'expo-constants';
import { ScrollView } from 'react-native';

let keyboardControllerModule = null;

const isExpoGo = Constants?.appOwnership === 'expo';

if (!isExpoGo) {
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
