// theme/normalizeTokens.js
import { Appearance } from 'react-native';
import { tokens } from './tokens';

export function buildTheme(mode) {
  const effective = mode === 'system' ? Appearance.getColorScheme?.() || 'light' : mode;
  const base = effective === 'dark' ? tokens.dark : tokens.light;

  const colors = {
    background: base.colors.background ?? base.colors.bg ?? '#FFFFFF',
    surface: base.colors.surface ?? base.colors.card ?? '#FFFFFF',
    text: base.colors.text ?? '#0A0A0A',
    textSecondary: base.colors.textSecondary ?? '#6B7280',
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
    danger: base.colors.danger,
    worker: base.colors.worker ?? '#5856D6',
    bg: base.colors.background ?? base.colors.bg,
    card: base.colors.card ?? base.colors.surface ?? '#FFFFFF',
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
      radius:
        typeof base.components?.button?.radius === 'number'
          ? base.components.button.radius
          : radii[base.components?.button?.radius] ?? radii.lg,
      borderWidth: base.components?.button?.borderWidth ?? 1,
      disabledOpacity: base.components?.button?.disabledOpacity ?? 0.5,
      pressedScale: base.components?.button?.pressedScale ?? 0.97,
      pressedOpacity: base.components?.button?.pressedOpacity ?? 0.9,
      pressInDuration: base.components?.button?.pressInDuration ?? 90,
      pressOutDuration: base.components?.button?.pressOutDuration ?? 140,
      hitSlop: base.components?.button?.hitSlop ?? 8,
      pressRetentionOffset: base.components?.button?.pressRetentionOffset ?? 20,
      groupGap:
        typeof base.components?.button?.groupGap === 'number'
          ? base.components.button.groupGap
          : spacing[base.components?.button?.groupGap] ?? spacing.md,
    },
    card: {
      borderWidth: base.components?.card?.borderWidth ?? 1,
      padX: base.components?.card?.padX ?? 'lg',
      padY: base.components?.card?.padY ?? 'lg',
      radius:
        typeof base.components?.card?.radius === 'number'
          ? base.components.card.radius
          : radii[base.components?.card?.radius] ?? radii.xl,
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
      ml: base.components?.sectionTitle?.ml ?? 'sm', // spacing key
      fontSize:
        typeof base.components?.sectionTitle?.fontSize === 'number'
          ? base.components.sectionTitle.fontSize
          : typography.sizes[base.components?.sectionTitle?.fontSize] ?? typography.sizes.sm,
      fontWeight:
        typography.weight[base.components?.sectionTitle?.fontWeight] ??
        base.components?.sectionTitle?.fontWeight ??
        typography.weight.bold,
    },
    sectionHeader: {
      top: base.components?.sectionHeader?.top ?? 'md',
      bottom: base.components?.sectionHeader?.bottom ?? 'xs',
    },
    screenLayout: {
      contentPaddingX:
        typeof base.components?.screenLayout?.contentPaddingX === 'number'
          ? base.components.screenLayout.contentPaddingX
          : spacing[base.components?.screenLayout?.contentPaddingX] ?? spacing.lg,
      contentPaddingBottom:
        typeof base.components?.screenLayout?.contentPaddingBottom === 'number'
          ? base.components.screenLayout.contentPaddingBottom
          : spacing[base.components?.screenLayout?.contentPaddingBottom] ?? spacing.xxl,
      sectionGap:
        typeof base.components?.screenLayout?.sectionGap === 'number'
          ? base.components.screenLayout.sectionGap
          : spacing[base.components?.screenLayout?.sectionGap] ?? spacing.sm,
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
      trailingSlotWidth: base.components?.input?.trailingSlotWidth ?? undefined,
      trailingGap: base.components?.input?.trailingGap ?? 8,
      separator: {
        enabled: base.components?.input?.separator?.enabled ?? true,
        insetX:
          base.components?.input?.separator?.insetX ??
          base.components?.listItem?.dividerInsetX ??
          'md',
        height:
          base.components?.input?.separator?.height ??
          base.components?.listItem?.dividerWidth ??
          1,
        color:
          base.components?.input?.separator?.color ??
          base.components?.listItem?.dividerColor ??
          'border',
      },
    },
    toast: { anchorOffset: base.components?.toast?.anchorOffset ?? 120 },
    scrollView: {
      paddingBottom: base.components?.scrollView?.paddingBottom ?? base.spacing?.xl ?? 24,
    },
    keyboardAware: {
      bottomOffset: base.components?.keyboardAware?.bottomOffset ?? 20,
      extraKeyboardSpace: base.components?.keyboardAware?.extraKeyboardSpace ?? 0,
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
  };

  // Pass-through shared media config (used by ImagePicker, etc.)
  const media = {
    aspect: base.components?.media?.aspect ?? [1, 1],
    quality: base.components?.media?.quality ?? 0.85,
  };

  const timings = {
    requestTimeoutMs: base.timings?.requestTimeoutMs ?? 12000,
    backDelayMs: base.timings?.backDelayMs ?? 300,
    emailDebounceMs: base.timings?.emailDebounceMs ?? 450,
    invalidInputWarningMs: base.timings?.invalidInputWarningMs ?? 2200,
    postRegisterNavDelayMs: base.timings?.postRegisterNavDelayMs ?? 500,
  };
  return {
    mode: effective,
    colors,
    shadows: normalizedShadows,
    typography,
    radii,
    spacing,
    components,
    media,
    timings,
    _raw: base,
  };
}
