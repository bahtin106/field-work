import { Keyboard, Platform, TextInput } from 'react-native';

/**
 * Runs the shared pre-submit behavior for every form confirmation action.
 * Keep this synchronous so validation and the submit handler start in the
 * same press event, while the native keyboard begins closing immediately.
 */
export function prepareFormSubmit(formContext) {
  dismissKeyboardBeforeAction();
  formContext?.beginValidationAttempt?.();
}

export function dismissKeyboardBeforeAction() {
  if (Platform.OS === 'ios') {
    try {
      // On iOS, blur the field that is focused at the moment of the submit.
      // A global keyboard-hide listener can run after focus has already moved
      // and blur an unrelated input instead.
      TextInput.State?.currentlyFocusedInput?.()?.blur?.();
    } catch {
      // Keyboard.dismiss below remains a safe fallback.
    }
  }
  Keyboard.dismiss();
}
