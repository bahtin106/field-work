import { Platform, StatusBar } from 'react-native';
import Constants from 'expo-constants';

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

  const bg = theme?.colors?.background ?? '#F2F2F7';
  const barStyle = resolveStatusBarStyle(theme?.mode);

  try {
    StatusBar.setTranslucent(false);
    StatusBar.setBackgroundColor(bg, true);
    StatusBar.setBarStyle(barStyle, true);
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
  {
    backgroundColor,
    behavior = 'inset-swipe',
  } = {},
) {
  if (Platform.OS !== 'android') return;

  const bg =
    backgroundColor ??
    theme?.colors?.navigationBarBg ??
    theme?.colors?.backgroundSecondary ??
    theme?.colors?.card ??
    theme?.colors?.surface ??
    theme?.colors?.background ??
    '#FFFFFF';
  const buttonStyle = resolveNavigationButtonsStyle(theme?.mode);
  const appOwnership = String(Constants?.appOwnership || '').toLowerCase();
  const isExpoGo = appOwnership === 'expo';

  try {
    const NavigationBar = await import('expo-navigation-bar');
    if (typeof NavigationBar.setVisibilityAsync === 'function') {
      await NavigationBar.setVisibilityAsync('visible');
    }
    if (!isExpoGo && typeof NavigationBar.setBehaviorAsync === 'function') {
      await NavigationBar.setBehaviorAsync(behavior);
    }
    if (!isExpoGo && typeof NavigationBar.setBackgroundColorAsync === 'function') {
      await NavigationBar.setBackgroundColorAsync(bg);
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
