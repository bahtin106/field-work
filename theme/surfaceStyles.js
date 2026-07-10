import { Platform } from 'react-native';

export const getCardSurfaceStyle = (theme, { shadow = true } = {}) => {
  const card = theme.components?.card || {};
  const shadowName = card.shadow ?? 'card';
  const shadowTokens = theme.shadows?.[shadowName] ?? theme.shadows?.card ?? {};

  return {
    backgroundColor: theme.colors.surface,
    borderRadius: card.radius ?? theme.radii.xl,
    borderWidth: card.borderWidth ?? 1,
    borderColor: theme.colors.border,
    ...(shadow
      ? Platform.OS === 'ios'
        ? shadowTokens.ios ?? {}
        : shadowTokens.android ?? {}
      : null),
  };
};
