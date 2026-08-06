import { Platform, StatusBar } from 'react-native';

const LIGHT_STATUS_BAR = 'dark-content';
const DARK_STATUS_BAR = 'light-content';
const LIGHT_NAV_BUTTONS = 'dark';
const DARK_NAV_BUTTONS = 'light';

function resolveStatusBarStyle(themeMode) {
  return themeMode === 'dark' ? DARK_STATUS_BAR : LIGHT_STATUS_BAR;
}

function resolveNavigationButtonsStyle(themeMode) {
  return themeMode === 'dark' ? DARK_NAV_BUTTONS : LIGHT_NAV_BUTTONS;
}

export function applyAndroidStatusBar(theme) {
  if (Platform.OS !== 'android') return;

  const barStyle = resolveStatusBarStyle(theme?.mode);
  const backgroundColor = theme?.colors?.background ?? '#F2F2F7';

  try {
    StatusBar.setBarStyle(barStyle, true);
  } catch {}
  try {
    // API 24-34 still owns a real status-bar surface on some manufacturer
    // builds. Keep it in sync with the live app theme; Android 15+ draws the
    // edge-to-edge root view behind the transparent system bar instead.
    if (Number(Platform.Version) < 35) {
      StatusBar.setBackgroundColor(backgroundColor, false);
    }
  } catch {}
}

async function applyAndroidSystemBackground(theme) {
  if (Platform.OS !== 'android') return;
  const bg = theme?.colors?.background ?? '#F2F2F7';
  try {
    const SystemUI = await import('expo-system-ui');
    if (typeof SystemUI.setBackgroundColorAsync === 'function') {
      await SystemUI.setBackgroundColorAsync(bg);
    }
  } catch {}
}

export async function applyAndroidNavigationBar(
  theme,
  _options = {},
) {
  if (Platform.OS !== 'android') return;

  const buttonStyle = resolveNavigationButtonsStyle(theme?.mode);

  try {
    const NavigationBar = await import('expo-navigation-bar');
    if (typeof NavigationBar.setVisibilityAsync === 'function') {
      await NavigationBar.setVisibilityAsync('visible');
    }
    await NavigationBar.setButtonStyleAsync(buttonStyle);
  } catch {}
}

export async function applyAndroidSystemBars(theme, options = {}) {
  if (Platform.OS !== 'android') return;

  applyAndroidStatusBar(theme);
  await applyAndroidSystemBackground(theme);

  await applyAndroidNavigationBar(theme, {
    behavior: options.navigationBarBehavior ?? 'inset-swipe',
    backgroundColor: options.navigationBarColor,
  });
}
