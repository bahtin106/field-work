// theme/ThemeProvider.jsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Appearance,
  findNodeHandle,
  FlatList,
  Keyboard,
  Platform,
  ScrollView,
  SectionList,
  Text,
  TextInput,
  useColorScheme,
} from 'react-native';
import { KeyboardAwareScrollView } from '../lib/keyboardControllerCompat';
import { tokens } from './tokens';

const STORAGE_KEY = 'THEME_MODE_V2';

// Mix two HEX colors (like CSS overlay but returns opaque color). ratio is 0..1 of top color.
function mixHexColors(baseHex, topHex, ratio = 0.08) {
  try {
    const toRGB = (h) => {
      const m = String(h || '')
        .trim()
        .match(/^#?([0-9a-fA-F]{6})$/);
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    };
    const b = toRGB(baseHex);
    const t = toRGB(topHex);
    if (!b || !t) return baseHex || topHex;
    const k = Math.max(0, Math.min(1, Number(ratio)));
    const r = Math.round(b.r * (1 - k) + t.r * k);
    const g = Math.round(b.g * (1 - k) + t.g * k);
    const bch = Math.round(b.b * (1 - k) + t.b * k);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + bch).toString(16).slice(1).toUpperCase();
  } catch {
    return baseHex;
  }
}

const resolveThemeScaleValue = (scale, value, fallback) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && scale?.[value] !== undefined) return scale[value];
  return fallback;
};

function buildTheme(mode, systemScheme = null) {
  const effective = mode === 'system' ? systemScheme || Appearance.getColorScheme?.() || 'light' : mode;
  const base = effective === 'dark' ? tokens.dark : tokens.light;

  const colors = {
    background: base.colors.background ?? base.colors.bg ?? '#FFFFFF',
    surface: base.colors.surface ?? base.colors.card ?? '#FFFFFF',
    // Opaque blend for suspended cards: mix surface with danger at ~8%
    surfaceMutedDanger: mixHexColors(
      base.colors.surface ?? base.colors.card ?? '#FFFFFF',
      base.colors.danger ?? '#FF3B30',
      0.08,
    ),
    text: base.colors.text ?? '#0A0A0A',
    textSecondary: base.colors.textSecondary ?? '#6B7280',
    textStrong: base.colors.textStrong ?? base.colors.text ?? '#0A0A0A',
    muted: base.colors.muted ?? base.colors.textSecondary ?? '#6B7280',
    primary: base.colors.primary ?? base.colors.accent ?? '#007AFF',
    onPrimary: base.colors.onPrimary ?? base.colors.primaryTextOn ?? '#FFFFFF',
    primaryTextOn: base.colors.primaryTextOn ?? base.colors.onPrimary ?? '#FFFFFF',
    border: base.colors.border ?? '#E5E7EB',
    inputBg: base.colors.inputBg ?? base.colors.surface ?? '#FFFFFF',
    inputBorder: base.colors.inputBorder ?? base.colors.border ?? '#E5E7EB',
    placeholder: base.colors.inputPlaceholder ?? base.colors.textSecondary ?? '#9CA3AF',
    inputPlaceholder: base.colors.inputPlaceholder ?? base.colors.textSecondary ?? '#9CA3AF',
    tagBg: base.colors.tagBg ?? (effective === 'dark' ? '#263548' : '#EEF2F6'),
    tagBorder: base.colors.tagBorder ?? (effective === 'dark' ? '#49637D' : '#D7DEE8'),
    tagText: base.colors.tagText ?? (effective === 'dark' ? '#EAF2FF' : '#4A5565'),
    overlay: base.colors.overlay ?? 'rgba(0,0,0,0.35)',
    overlayNavBar: base.colors.overlayNavBar ?? base.colors.overlay ?? 'rgba(0,0,0,0.35)',
    success: base.colors.success,
    warning: base.colors.warning,
    info: base.colors.info ?? (effective === 'dark' ? '#64B5F6' : '#2196F3'),
    danger: base.colors.danger,
    worker: base.colors.worker ?? '#5856D6',
    bg: base.colors.background ?? base.colors.bg,
    card: base.colors.card ?? base.colors.surface ?? '#FFFFFF',
    cardShadow: base.colors.cardShadow ?? (effective === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.06)'),
    shadow: base.colors.shadow ?? base.colors.cardShadow ?? (effective === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.06)'),
    accent: base.colors.primary ?? base.colors.accent,
    accentTextOn: base.colors.onPrimary ?? base.colors.primaryTextOn,
    navigationBarBg: base.colors.navigationBarBg ?? base.colors.navbar ?? base.colors.surface,
    navbar: base.colors.navbar ?? base.colors.navigationBarBg ?? base.colors.surface,
    ripple:
      base.colors.ripple ?? (effective === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'),
    button: {
      primaryBg: base.colors.button?.primaryBg ?? base.colors.primary ?? '#007AFF',
      primaryText: base.colors.button?.primaryText ?? base.colors.onPrimary ?? '#FFFFFF',
      secondaryBg:
        base.colors.button?.secondaryBg ?? (effective === 'dark' ? '#3A4254' : '#EEF1F6'),
      secondaryText: base.colors.button?.secondaryText ?? base.colors.text ?? '#0A0A0A',
      dangerBg: base.colors.button?.dangerBg ?? (effective === 'dark' ? '#FF453A' : '#FF3B30'),
      dangerText: base.colors.button?.dangerText ?? '#FFFFFF',
    },
    status: {
      feed: base.colors.status?.feed ?? {
        bg: effective === 'dark' ? '#2B2414' : '#FFF7CC',
        fg: effective === 'dark' ? '#EBCB6E' : '#8A6D1F',
      },
      new: base.colors.status?.new ?? {
        bg: effective === 'dark' ? '#0F1B2D' : '#E8F0FE',
        fg: effective === 'dark' ? '#64A3FF' : '#0A84FF',
      },
      progress: base.colors.status?.progress ?? {
        bg: effective === 'dark' ? '#0F2317' : '#E9F7EF',
        fg: '#34C759',
      },
      done: base.colors.status?.done ?? {
        bg: effective === 'dark' ? '#1A1C22' : '#F2F2F7',
        fg: effective === 'dark' ? '#A3A3A3' : '#6B7280',
      },
      default: base.colors.status?.default ?? {
        bg: effective === 'dark' ? '#1A1C22' : '#EEF2F6',
        fg: effective === 'dark' ? '#A3A3A3' : '#6B7280',
      },
    },
  };

  const normalizedShadows = {
    card: base.shadows?.card ?? {
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 2 },
    },
    level1: base.shadows?.card ?? {},
    level2: base.shadows?.raised ?? {},
    ...(base.shadows || {}),
  };

  const typography = {
    sizes: {
      xs: base.typography?.sizes?.xs ?? 11,
      sm: base.typography?.sizes?.sm ?? 13,
      md: base.typography?.sizes?.md ?? 15,
      lg: base.typography?.sizes?.lg ?? 17,
      xl: base.typography?.sizes?.xl ?? 20,
      xxl: base.typography?.sizes?.xxl ?? 24,
      display: base.typography?.sizes?.display ?? 34,
    },
    lineHeights: {
      tight: base.typography?.lineHeights?.tight ?? 1.1,
      normal: base.typography?.lineHeights?.normal ?? 1.35,
      relaxed: base.typography?.lineHeights?.relaxed ?? 1.5,
    },
    fontFamily: base.typography?.fontFamily,
    weight: {
      regular: base.typography?.weight?.regular ?? '400',
      medium: base.typography?.weight?.medium ?? '500',
      semibold: base.typography?.weight?.semibold ?? '600',
      bold: base.typography?.weight?.bold ?? '700',
    },
  };

  const radii = {
    xs: base.radii?.xs ?? 6,
    sm: base.radii?.sm ?? 8,
    md: base.radii?.md ?? 12,
    lg: base.radii?.lg ?? 16,
    xl: base.radii?.xl ?? 24,
    pill: base.radii?.pill ?? 999,
  };

  const spacing = {
    xs: base.spacing?.xs ?? 6,
    sm: base.spacing?.sm ?? 10,
    md: base.spacing?.md ?? 14,
    lg: base.spacing?.lg ?? 18,
    xl: base.spacing?.xl ?? 24,
    xxl: base.spacing?.xxl ?? 32,
  };

  const components = {
    button: {
      palette: {
        primary: base.components?.button?.palette?.primary ?? {
          bg: colors.button.primaryBg,
          fg: colors.button.primaryText,
          border: colors.button.primaryBg,
        },
        secondary: base.components?.button?.palette?.secondary ?? {
          bg: colors.button.secondaryBg,
          fg: colors.button.secondaryText,
          border: colors.border,
        },
        outline: base.components?.button?.palette?.outline ?? {
          bg: colors.surface,
          fg: colors.button.primaryBg,
          border: colors.button.primaryBg,
        },
        ghost: base.components?.button?.palette?.ghost ?? {
          bg: colors.surface,
          fg: colors.text,
          border: colors.border,
        },
        destructive: base.components?.button?.palette?.destructive ?? {
          bg: colors.button.dangerBg,
          fg: colors.button.dangerText,
          border: colors.button.dangerBg,
        },
      },
      sizes: {
        sm: base.components?.button?.sizes?.sm ?? {
          h: 40,
          f: typography.sizes.sm,
          pad: spacing.md,
        },
        md: base.components?.button?.sizes?.md ?? {
          h: 48,
          f: typography.sizes.md,
          pad: spacing.md,
        },
        lg: base.components?.button?.sizes?.lg ?? {
          h: 56,
          f: typography.sizes.lg,
          pad: spacing.lg,
        },
      },
      radius: resolveThemeScaleValue(radii, base.components?.button?.radius, radii.lg),
      borderWidth: base.components?.button?.borderWidth ?? 1,
      disabledOpacity: base.components?.button?.disabledOpacity ?? 0.5,
      pressedScale: base.components?.button?.pressedScale ?? 0.97,
      pressedOpacity: base.components?.button?.pressedOpacity ?? 0.9,
      pressInDuration: base.components?.button?.pressInDuration ?? 90,
      pressOutDuration: base.components?.button?.pressOutDuration ?? 140,
      hitSlop: base.components?.button?.hitSlop ?? 8,
      pressRetentionOffset: base.components?.button?.pressRetentionOffset ?? 20,
      groupGap: resolveThemeScaleValue(
        spacing,
        base.components?.button?.groupGap,
        spacing.md,
      ),
    },
    card: {
      borderWidth: base.components?.card?.borderWidth ?? 1,
      padX: base.components?.card?.padX ?? 'sm',
      padY: base.components?.card?.padY ?? 'sm',
      radius: resolveThemeScaleValue(
        radii,
        base.components?.card?.radius,
        radii.xl,
      ),
      shadow: base.components?.card?.shadow ?? 'card',
    },
    listItem: {
      height: base.components?.listItem?.height ?? 48,
      compactHeight: base.components?.listItem?.compactHeight ?? 36,
      padX: base.components?.listItem?.padX ?? 'md',
      padY: base.components?.listItem?.padY ?? 'xs',
      dividerWidth: base.components?.listItem?.dividerWidth ?? 1,
      dividerInsetX: base.components?.listItem?.dividerInsetX ?? 'md',
      dividerColor: base.components?.listItem?.dividerColor ?? 'border',
      disabledOpacity: base.components?.listItem?.disabledOpacity ?? 0.5,
      chevronSize: base.components?.listItem?.chevronSize ?? 20,
      chevronGap: base.components?.listItem?.chevronGap ?? 8,
      labelValueGap: base.components?.listItem?.labelValueGap ?? 8,
      valueReserve: base.components?.listItem?.valueReserve ?? 24,
    },
    orderStatusCapsule: {
      padX: base.components?.orderStatusCapsule?.padX ?? 10,
      padY: base.components?.orderStatusCapsule?.padY ?? 6,
      radius: base.components?.orderStatusCapsule?.radius ?? radii.pill ?? 999,
      minHeight: base.components?.orderStatusCapsule?.minHeight ?? 28,
      fontSize: base.components?.orderStatusCapsule?.fontSize ?? typography.sizes?.xs ?? 12,
      fontWeight:
        base.components?.orderStatusCapsule?.fontWeight ?? typography.weight?.bold ?? '700',
      letterSpacing: base.components?.orderStatusCapsule?.letterSpacing ?? 0.3,
    },
    switch: {
      scale: base.components?.switch?.scale ?? 1,
      minTouchSize: base.components?.switch?.minTouchSize ?? 48,
      disabledOpacity: base.components?.switch?.disabledOpacity ?? 0.42,
      thumbColor: base.components?.switch?.thumbColor ?? '#FFFFFF',
      trackOn: base.components?.switch?.trackOn ?? colors.primary,
      trackOff: base.components?.switch?.trackOff ?? colors.inputBorder ?? colors.border,
      trackOnDisabled:
        base.components?.switch?.trackOnDisabled ??
        base.colors?.primaryDisabled ??
        base.components?.switch?.trackOn ??
        colors.primary,
      trackOffDisabled:
        base.components?.switch?.trackOffDisabled ??
        base.components?.switch?.trackOff ??
        colors.inputBorder ??
        colors.border,
      iosBackgroundColor: base.components?.switch?.iosBackgroundColor ?? base.colors?.inputBorder ?? '#E5E7EB',
    },
    // NEW: sensible defaults; additive, won't break existing usage
    sectionTitle: {
      // Р›РµРІС‹Р№ РѕС‚СЃС‚СѓРї Р·Р°РіРѕР»РѕРІРєР° СЃРµРєС†РёРё
      ml: base.components?.sectionTitle?.ml ?? 'lg',
      // Р¤РѕР»Р±СЌРєРё РґР»СЏ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё (РµСЃР»Рё РіРґРµ-С‚Рѕ С‡РёС‚Р°СЋС‚ mt/mb)
      fontSize: resolveThemeScaleValue(
        typography.sizes,
        base.components?.sectionTitle?.fontSize,
        typography.sizes.sm,
      ),
      fontWeight:
        typography.weight?.[base.components?.sectionTitle?.fontWeight] ??
        base.components?.sectionTitle?.fontWeight ??
        typography.weight.bold,
    },
    // Р•РґРёРЅС‹Рµ РѕС‚СЃС‚СѓРїС‹ РІРѕРєСЂСѓРі Р·Р°РіРѕР»РѕРІРєРѕРІ СЃРµРєС†РёР№ (РѕР±РµСЂС‚РєР° SectionHeader)
    sectionHeader: {
      top: base.components?.sectionHeader?.top ?? 'md',
      bottom: base.components?.sectionHeader?.bottom ?? 'xs',
    },
    screenLayout: {
      contentPaddingX: resolveThemeScaleValue(
        spacing,
        base.components?.screenLayout?.contentPaddingX,
        spacing.lg,
      ),
      contentPaddingBottom: resolveThemeScaleValue(
        spacing,
        base.components?.screenLayout?.contentPaddingBottom,
        spacing.xxl,
      ),
      sectionGap: resolveThemeScaleValue(
        spacing,
        base.components?.screenLayout?.sectionGap,
        spacing.sm,
      ),
      floatingActionClearance:
        base.components?.screenLayout?.floatingActionClearance ?? 88,
    },
    row: {
      minHeight: base.components?.row?.minHeight ?? base.components?.listItem?.height ?? 48,
      py: base.components?.row?.py ?? null, // optional vertical padding (we set fixed height in screen)
      gapX: base.components?.row?.gapX ?? 'sm', // spacing key
    },
    avatar: {
      xl: base.components?.avatar?.xl ?? 120,
      lg: base.components?.avatar?.lg ?? 96,
      md: base.components?.avatar?.md ?? 48,
      border: base.components?.avatar?.border ?? 1,
    },

    iconButton: {
      size: base.components?.iconButton?.size ?? 32,
      sizes: base.components?.iconButton?.sizes ?? { sm: 28, md: 32, lg: 40 },
      radius: base.components?.iconButton?.radius ?? { sm: 'sm', md: 'md', lg: 'lg' },
      palette: base.components?.iconButton?.palette,
      disabledOpacity: base.components?.iconButton?.disabledOpacity ?? 0.5,
      pressedScale: base.components?.iconButton?.pressedScale ?? 0.94,
      pressInDuration: base.components?.iconButton?.pressInDuration ?? 80,
      hitSlop: base.components?.iconButton?.hitSlop ?? 8,
      contentPaddingX: base.components?.iconButton?.contentPaddingX ?? 6,
    },
    segmented: {
      inactiveBg: base.components?.segmented?.inactiveBg ?? colors.button.secondaryBg,
      inactiveFg: base.components?.segmented?.inactiveFg ?? colors.button.secondaryText,
      activeBg: base.components?.segmented?.activeBg ?? colors.button.primaryBg,
      activeFg: base.components?.segmented?.activeFg ?? colors.button.primaryText,
    },
    interactive: {
      hitSlop:
        base.components?.interactive?.hitSlop ?? { top: 8, bottom: 8, left: 8, right: 8 },
      pressRetentionOffset:
        base.components?.interactive?.pressRetentionOffset ??
        { top: 16, bottom: 16, left: 16, right: 16 },
      rippleRadius: base.components?.interactive?.rippleRadius ?? 24,
      rippleBorderless: base.components?.interactive?.rippleBorderless ?? false,
      pressedScale: base.components?.interactive?.pressedScale ?? 0.98,
      pressedTint: base.components?.interactive?.pressedTint ?? 0.12,
      pressInDuration: base.components?.interactive?.pressInDuration ?? 80,
      pressOutDuration: base.components?.interactive?.pressOutDuration ?? 140,
      disabledOpacity: base.components?.interactive?.disabledOpacity ?? 0.5,
    },
    input: {
      height: base.components?.input?.height ?? base.components?.listItem?.height ?? 48,
      trailingSlotWidth: base.components?.input?.trailingSlotWidth ?? undefined,
      trailingGap: base.components?.input?.trailingGap ?? 8,
      autoGrow: base.components?.input?.autoGrow ?? false,
      autoGrowMaxRows: base.components?.input?.autoGrowMaxRows ?? 5,
      separator: {
        insetX: base.components?.input?.separator?.insetX ?? 'lg',
        height:
          base.components?.input?.separator?.height ?? base.components?.listItem?.dividerWidth ?? 1,
        color:
          base.components?.input?.separator?.color ??
          base.components?.listItem?.dividerColor ??
          'border',
        alpha: base.components?.input?.separator?.alpha ?? 0.18,
        errorAlpha: base.components?.input?.separator?.errorAlpha ?? 0.28,
      },
    },
    toast: { anchorOffset: base.components?.toast?.anchorOffset ?? 120 },
    scrollView: {
      paddingBottom: base.components?.scrollView?.paddingBottom ?? base.spacing?.xl ?? 24,
    },
    keyboardAware: {
      bottomOffset: base.components?.keyboardAware?.bottomOffset ?? 20,
      extraKeyboardSpace:
        base.components?.keyboardAware?.extraKeyboardSpace ?? 0,
    },
    datetimeModal: {
      maxHeightRatio: base.components?.datetimeModal?.maxHeightRatio ?? 0.65,
      innerGap: base.components?.datetimeModal?.innerGap ?? 8,
      wheelMinWidth: base.components?.datetimeModal?.wheelMinWidth ?? 64,
      segmentedBorderWidth:
        base.components?.datetimeModal?.segmentedBorderWidth ?? 1,
      segmentedRadius: base.components?.datetimeModal?.segmentedRadius ?? 12,
      segmentedPaddingY:
        base.components?.datetimeModal?.segmentedPaddingY ?? 8,
      segmentedActiveAlpha:
        base.components?.datetimeModal?.segmentedActiveAlpha ?? 0.12,
      segmentedPressedOpacity:
        base.components?.datetimeModal?.segmentedPressedOpacity ?? 0.85,
      wheelSectionGap:
        base.components?.datetimeModal?.wheelSectionGap ?? 10,
      selectionBackgroundAlpha:
        base.components?.datetimeModal?.selectionBackgroundAlpha ?? 0.06,
      selectionBorderWidth:
        base.components?.datetimeModal?.selectionBorderWidth ?? 1,
      selectionBorderAlpha:
        base.components?.datetimeModal?.selectionBorderAlpha ?? 0.22,
      selectionRadius:
        base.components?.datetimeModal?.selectionRadius ?? 12,
      omitYearPaddingX:
        base.components?.datetimeModal?.omitYearPaddingX ?? 4,
      omitYearPaddingLeft:
        base.components?.datetimeModal?.omitYearPaddingLeft ?? 12,
      omitYearPaddingY:
        base.components?.datetimeModal?.omitYearPaddingY ?? 6,
      omitYearTextSize:
        base.components?.datetimeModal?.omitYearTextSize ?? 15,
      omitYearSpacerWidth:
        base.components?.datetimeModal?.omitYearSpacerWidth ?? 12,
    },
    filtersPanel: {
      openSpring: {
        damping: base.components?.filtersPanel?.openSpring?.damping ?? 28,
        stiffness: base.components?.filtersPanel?.openSpring?.stiffness ?? 260,
        mass: base.components?.filtersPanel?.openSpring?.mass ?? 0.85,
      },
      closeDuration: base.components?.filtersPanel?.closeDuration ?? 280,
      swipeEdgeWidth: base.components?.filtersPanel?.swipeEdgeWidth ?? 32,
      swipeCloseRatio: base.components?.filtersPanel?.swipeCloseRatio ?? 0.25,
      swipeCloseVelocity: base.components?.filtersPanel?.swipeCloseVelocity ?? 0.55,
      minColumnRatio: base.components?.filtersPanel?.minColumnRatio ?? 0.2,
      maxColumnRatio: base.components?.filtersPanel?.maxColumnRatio ?? 0.5,
    },
    activityIndicator: { size: base.components?.activityIndicator?.size ?? 'large' },
    // Р“Р»РѕР±Р°Р»СЊРЅС‹Рµ РЅР°СЃС‚СЂРѕР№РєРё С…РµРґРµСЂР° Рё Р±РµРіСѓС‰РµР№ СЃС‚СЂРѕРєРё
    header: {
      height: base.components?.header?.height ?? 56,
      edgePadding: base.components?.header?.edgePadding ?? spacing.md,
      marquee: {
        gap: base.components?.header?.marquee?.gap ?? spacing.lg,
        msPerPixel: base.components?.header?.marquee?.msPerPixel ?? 12,
        startDelay: base.components?.header?.marquee?.startDelay ?? 700,
        endPause: base.components?.header?.marquee?.endPause ?? 900,
        titleFontSize:
          base.components?.header?.marquee?.titleFontSize ?? typography.sizes?.lg ?? 17,
        titleFontWeight:
          base.components?.header?.marquee?.titleFontWeight ?? typography.weight?.semibold ?? '600',
      },
    },
  };

  // Pass-through shared media config (used by ImagePicker, etc.)
  const media = {
    aspect: base.components?.media?.aspect ?? [1, 1],
    quality: base.components?.media?.quality ?? 0.85,
  };

  const timings = {
    requestTimeoutMs: base.timings?.requestTimeoutMs ?? 12000,
    backDelayMs: base.timings?.backDelayMs ?? 300,
    presenceOnlineWindowMs: base.timings?.presenceOnlineWindowMs ?? 120000,
    presenceFutureSkewMs: base.timings?.presenceFutureSkewMs ?? 300000,
    panelToggleMs: base.timings?.panelToggleMs ?? 220,
    // App-specific UX timings
    emailDebounceMs: base.timings?.emailDebounceMs ?? 800,
    invalidInputWarningMs: base.timings?.invalidInputWarningMs ?? 3000,
    postRegisterNavDelayMs: base.timings?.postRegisterNavDelayMs ?? 1000,
  };
  const icons = {
    sm: base.icons?.sm ?? 18,
    md: base.icons?.md ?? 22,
    lg: base.icons?.lg ?? 28,
  };

  return {
    mode: effective,
    colors,
    shadows: normalizedShadows,
    typography,
    radii,
    spacing,
    components,
    icons,
    media,
    timings,
    _raw: base,
  };
}

const ThemeContext = createContext({
  theme: buildTheme('light'),
  mode: 'light',
  setMode: (_m) => {},
  toggle: () => {},
});

export const ThemeProvider = ({ children }) => {
  const colorSchemeFromHook = useColorScheme();
  const [systemSchemeState, setSystemSchemeState] = useState(
    () => Appearance.getColorScheme?.() || 'light',
  );
  const [mode, setMode] = useState('system');

  useEffect(() => {
    if (colorSchemeFromHook === 'light' || colorSchemeFromHook === 'dark') {
      setSystemSchemeState(colorSchemeFromHook);
    }
  }, [colorSchemeFromHook]);

  useEffect(() => {
    const refreshSystemScheme = () => {
      const next = Appearance.getColorScheme?.();
      if (next === 'light' || next === 'dark') {
        setSystemSchemeState(next);
      }
    };

    refreshSystemScheme();

    const appearanceSub =
      typeof Appearance.addChangeListener === 'function'
        ? Appearance.addChangeListener(({ colorScheme }) => {
            if (colorScheme === 'light' || colorScheme === 'dark') {
              setSystemSchemeState(colorScheme);
            }
          })
        : null;

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshSystemScheme();
    });

    return () => {
      appearanceSub?.remove?.();
      appStateSub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (mode !== 'system') return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 8;
    const tick = () => {
      if (cancelled) return;
      const next = Appearance.getColorScheme?.();
      if (next === 'light' || next === 'dark') {
        setSystemSchemeState(next);
      }
      attempts += 1;
      if (attempts < maxAttempts) {
        setTimeout(tick, 250);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (alive && (saved === 'light' || saved === 'dark' || saved === 'system')) {
          setMode(saved);
        }
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
  }, [mode]);

  useEffect(() => {
    // Keep native and JS theme sources in sync.
    // `null` means "follow system" in React Native Appearance API.
    if (typeof Appearance.setColorScheme !== 'function') return;
    try {
      if (mode === 'system') {
        try {
          Appearance.setColorScheme(null);
        } catch {
          Appearance.setColorScheme('unspecified');
        }
      } else if (mode === 'light' || mode === 'dark') {
        Appearance.setColorScheme(mode);
      }
    } catch {}
  }, [mode]);

  const resolvedSystemScheme = colorSchemeFromHook || systemSchemeState || 'light';
  const theme = useMemo(() => buildTheme(mode, resolvedSystemScheme), [mode, resolvedSystemScheme]);

  const toggle = useCallback(() => {
    setMode((m) => (m === 'light' ? 'dark' : 'light'));
  }, []);
  const contextValue = useMemo(
    () => ({ theme, mode, setMode, toggle }),
    [mode, theme, toggle],
  );

  // Global scroll UX defaults: helps when drag starts on TextInput
  useEffect(() => {
    try {
      const setDefaults = (Comp, props) => {
        // Preserve existing defaults while applying ours
        Comp.defaultProps = { ...(Comp.defaultProps || {}), ...props };
      };

      const dismissFocusedOnOutsideTap = (e) => {
        try {
          const focusedInput =
            TextInput.State && typeof TextInput.State.currentlyFocusedInput === 'function'
              ? TextInput.State.currentlyFocusedInput()
              : null;
          const focusedField =
            TextInput.State && typeof TextInput.State.currentlyFocusedField === 'function'
              ? TextInput.State.currentlyFocusedField()
              : null;
          const focusedHandle = focusedInput ? findNodeHandle(focusedInput) : focusedField;
          if (!focusedHandle) return false;

          const target = e?.nativeEvent?.target;
          if (target && target === focusedHandle) return false;

          if (focusedInput && TextInput.State?.blurTextInput) {
            TextInput.State.blurTextInput(focusedInput);
          } else if (focusedField && TextInput.State?.blurTextInput) {
            TextInput.State.blurTextInput(focusedField);
          }
          Keyboard.dismiss();
        } catch {}
        return false;
      };

      const common = {
        keyboardShouldPersistTaps: 'never',
        keyboardDismissMode: 'on-drag',
        onStartShouldSetResponderCapture: dismissFocusedOnOutsideTap,
        ...(Platform.OS === 'android' ? { nestedScrollEnabled: true } : null),
      };
      setDefaults(ScrollView, common);
      setDefaults(FlatList, common);
      setDefaults(SectionList, common);
      setDefaults(KeyboardAwareScrollView, {
        keyboardShouldPersistTaps: 'handled',
        keyboardDismissMode: 'none',
        contentInsetAdjustmentBehavior: Platform.OS === 'ios' ? 'always' : 'automatic',
        bottomOffset: theme.components?.keyboardAware?.bottomOffset ?? 20,
        extraKeyboardSpace: theme.components?.keyboardAware?.extraKeyboardSpace ?? 0,
      });
      // Р“Р»РѕР±Р°Р»СЊРЅРѕРµ РїРѕРІРµРґРµРЅРёРµ РґР»СЏ С‚РµРєСЃС‚Р° РІ РїРѕР»СЏС…: РѕР±СЂРµР·Р°С‚СЊ РґР»РёРЅРЅС‹Рµ Р·РЅР°С‡РµРЅРёСЏ С‚СЂРѕРµС‚РѕС‡РёРµРј.
      // Р­С‚Рѕ СѓСЃС‚Р°РЅР°РІР»РёРІР°РµС‚ ellipsizeMode Рё РґРµС„РѕР»С‚РЅРѕРµ С‡РёСЃР»Рѕ Р»РёРЅРёР№ = 1. РљРѕРјРїРѕРЅРµРЅС‚С‹,
      // РіРґРµ РЅСѓР¶РЅРѕ РЅРµСЃРєРѕР»СЊРєРѕ СЃС‚СЂРѕРє, РґРѕР»Р¶РЅС‹ СЏРІРЅРѕ РїРµСЂРµРѕРїСЂРµРґРµР»РёС‚СЊ numberOfLines.
      setDefaults(Text, { ellipsizeMode: 'tail', numberOfLines: 1 });
    } catch {}
  }, [theme]);

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

