// theme/tokens.js
const light = {
  colors: {
    background: '#F2F2F7',
    surface: '#FFFFFF',
    text: '#0A0A0A',
    textSecondary: '#6B7280',
    textStrong: '#2D2D2D',
    muted: '#6B7280',
    primary: '#007AFF',
    onPrimary: '#FFFFFF',
    primaryTextOn: '#FFFFFF',
    border: '#E5E7EB',
    success: '#22C55E',
    warning: '#F59E0B',
    info: '#2196F3',
    worker: '#5856D6',
    danger: '#FF3B30',
    overlay: 'rgba(0,0,0,0.35)',
    overlayNavBar: 'rgba(0,0,0,0.25)',
    inputBg: '#FFFFFF',
    inputPlaceholder: '#9CA3AF',
    inputBorder: '#E5E7EB',
    transparent: 'transparent',
    cardShadow: 'rgba(0,0,0,0.06)',

    button: {
      primaryBg: '#007AFF',
      primaryText: '#FFFFFF',
      secondaryBg: '#EEF1F6',
      secondaryText: '#0A0A0A',
      dangerBg: '#FF3B30',
      dangerText: '#FFFFFF',
    },
    status: {
      feed: { bg: '#FFF7CC', fg: '#8A6D1F' },
      new: { bg: '#E8F0FE', fg: '#0A84FF' },
      progress: { bg: '#E9F7EF', fg: '#34C759' },
      done: { bg: '#F2F2F7', fg: '#6B7280' },
      default: { bg: '#EEF2F6', fg: '#6B7280' },
    },
    chipBg: '#E6F0FF',
    tagBg: '#EEF2F6',
    tagBorder: '#D7DEE8',
    tagText: '#4A5565',
    badgeBg: '#EEF1F6',
    primaryDisabled: '#9DC6FF',
    navigationBarBg: '#FFFFFF',
    bannerBg: '#E6F0FF',
  },
  radii: { xs: 6, sm: 8, md: 10, lg: 12, xl: 16, pill: 999 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
  typography: {
    fontFamily: 'System',
    sizes: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, xxl: 28, display: 34 },
    lineHeights: { tight: 1.1, normal: 1.35, relaxed: 1.5 },
    weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  },
  shadows: {
    card: {
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 2 },
    },
    raised: {
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 3 },
    },
  },
  icons: { sm: 18, md: 22, lg: 28 },
  components: {
    card: {
      borderWidth: 1,
      padX: 'lg', // 16px - стандарт iOS/Material
      padY: 'md', // 12px - компактный вертикальный паддинг
    },
    button: {
      palette: {
        primary: { bg: '#007AFF', fg: '#FFFFFF', border: '#007AFF' },
        secondary: { bg: '#EEF1F6', fg: '#0A0A0A', border: '#E5E7EB' },
        ghost: { bg: 'transparent', fg: '#0A0A0A', border: 'transparent' },
        destructive: { bg: '#FF3B30', fg: '#FFFFFF', border: '#FF3B30' },
      },
      sizes: {
        md: { h: 48, f: 16, pad: 12 },
        lg: { h: 56, f: 20, pad: 16 },
      },
    },
    tab: {
      indicatorHeight: 3,
      indicatorWidth: 24,
    },
    dialog: {
      maxWidth: 420,
      radius: 16,
      pad: 20,
      edgePadding: 16,
      backdropOpacity: { ios: 0.38, android: 0.42 },
    },
    modal: {
      radius: 16,
      edgePadding: 12,
      handleWidth: 48,
      handleHeight: 5,
      closeIconSize: 20,
      closeInset: 8,
      closeHitSlop: 10,
    },
    media: { aspect: [1, 1], quality: 0.85 },

    // Default row heights
    input: {
      height: 44, // Минимальная высота для touch по Apple HIG
      autoGrow: true,
      autoGrowMaxRows: 5,
      labelSpacing: 4, // Отступ между лейблом и полем
      fieldSpacing: 2, // Вертикальный отступ между полями внутри карточек
      separator: {
        enabled: true,
        insetX: 'md', // 12px - компактный инсет
        height: 1,
        alpha: 0.18,
        errorAlpha: 0.28,
      },
    },
    listItem: {
      height: 48,
      compactHeight: 36,
      padX: 'md',
      padY: 'xs',
      dividerWidth: 1,
      disabledOpacity: 0.5,
      chevronSize: 20,
      chevronGap: 8,
      labelValueGap: 8,
      valueReserve: 24,
    },
    orderStatusCapsule: {
      padX: 10,
      padY: 6,
      radius: 999,
      minHeight: 28,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    switch: {
      scale: 1,
      minTouchSize: 48,
      disabledOpacity: 0.42,
      thumbColor: '#FFFFFF',
      trackOn: '#007AFF',
      trackOff: '#D1D5DB',
      trackOnDisabled: '#9DC6FF',
      trackOffDisabled: '#E5E7EB',
      iosBackgroundColor: '#E5E7EB',
    },
    checkbox: {
      size: 22,
      radius: 4,
      borderWidth: 2,
      indicatorSize: 12,
      indicatorRadius: 2,
    },
    sectionTitle: {
      ml: 'lg',
      mt: 'xs',
      mb: 'xs',
    },
    sectionHeader: {
      top: 'md',
      bottom: 'xs',
    },
    header: {
      height: 56,
      sidePadding: 8,
      edgePadding: 12,
      rightMinWidth: 64,
      controlHeight: 32,
      controlRadius: 16,
      controlPaddingX: 8,
      controlPaddingY: 6,
      iconTouchPadding: 4,
      iconCircleSize: 36,
      iconSize: 22,
      titleGap: 8,
      closeTitleGap: 6,
      backLabelGap: 2,
      actionFontSize: 15,
      marquee: {
        gap: 16,
        msPerPixel: 12,
        startDelay: 700,
        endPause: 900,
        titleFontSize: 17,
        titleFontWeight: '600',
      },
    },
    activityIndicator: { size: 'large' },
    refreshFeedback: {
      size: 30,
      iconSize: 16,
      topOffset: 10,
      successDurationMs: 820,
    },
    scrollView: {
      paddingBottom: 24, // Standard scroll bottom padding
    },
    keyboardAware: {
      bottomOffset: 40,
      extraKeyboardSpace: 60,
    },
    calendarYear: {
      monthTitleSize: 11, // Компактный размер названия месяца
      dayHeaderSize: 9, // Размер заголовков дней недели
      dayNumberSize: 10, // Размер числа дня
      monthSpacing: 8, // Отступ между месяцами
      monthPadding: 6, // Внутренний отступ блока месяца
      eventDotSize: 3, // Размер точки-индикатора события
    },

    // Interactive elements (buttons, pressables, toggles)
    interactive: {
      hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
      pressRetentionOffset: { top: 16, bottom: 16, left: 16, right: 16 },
      rippleRadius: 24,
      rippleBorderless: false,
    },
  },

  timings: {
    requestTimeoutMs: 12000,
    backDelayMs: 300,
    emailDebounceMs: 450,
    invalidInputWarningMs: 2200,
    postRegisterNavDelayMs: 500,
    presenceOnlineWindowMs: 120000,
    presenceFutureSkewMs: 300000,
    panelToggleMs: 220,
  },
};

const dark = {
  ...light,
  colors: {
    ...light.colors,
    background: '#0A0B10',
    surface: '#141720',
    text: '#F3F5F8',
    textSecondary: '#A4ACB9',
    textStrong: '#FFFFFF',
    muted: '#98A2B3',
    worker: '#8A8CFF',
    border: '#262B36',
    success: '#22C55E',
    warning: '#F6B73C',
    info: '#73B8FF',
    danger: '#FF453A',
    inputBg: '#171B25',
    inputBorder: '#2B3140',
    cardShadow: 'rgba(0,0,0,0.5)',
    transparent: 'transparent',
    overlay: 'rgba(0,0,0,0.6)',
    overlayNavBar: 'rgba(0,0,0,0.45)',

    button: {
      primaryBg: '#2E7BFF',
      primaryText: '#FFFFFF',
      secondaryBg: '#1B2130',
      secondaryText: '#F3F5F8',
      dangerBg: '#FF453A',
      dangerText: '#FFFFFF',
    },
    status: {
      feed: { bg: '#2E2615', fg: '#F0CF75' },
      new: { bg: '#12233A', fg: '#73B8FF' },
      progress: { bg: '#10281A', fg: '#3DDC84' },
      done: { bg: '#1A1F29', fg: '#A4ACB9' },
      default: { bg: '#1A1F29', fg: '#A4ACB9' },
    },
    chipBg: '#1D2636',
    tagBg: '#202A39',
    tagBorder: '#334053',
    tagText: '#D7DFEA',
    badgeBg: '#1D2432',
    primaryDisabled: '#3B6FD6',
    navigationBarBg: '#10131B',
    bannerBg: '#1C2637',
  },
  shadows: {
    card: {
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
      },
      android: { elevation: 4 },
    },
    raised: {
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.45,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 14 },
      },
      android: { elevation: 6 },
    },
  },
  components: {
    ...light.components,
    button: {
      palette: {
        primary: { bg: '#2E7BFF', fg: '#FFFFFF', border: '#2E7BFF' },
        secondary: { bg: '#1B2130', fg: '#F3F5F8', border: '#2B3140' },
        ghost: { bg: 'transparent', fg: '#F3F5F8', border: 'transparent' },
        destructive: { bg: '#FF453A', fg: '#FFFFFF', border: '#FF453A' },
      },
      sizes: {
        md: { h: 48, f: 16, pad: 12 },
        lg: { h: 56, f: 20, pad: 16 },
      },
    },
    tab: {
      indicatorHeight: 3,
      indicatorWidth: 24,
    },
    dialog: {
      maxWidth: 420,
      radius: 18,
      pad: 20,
      edgePadding: 16,
      backdropOpacity: { ios: 0.42, android: 0.48 },
    },
    modal: {
      radius: 18,
      edgePadding: 12,
      handleWidth: 48,
      handleHeight: 5,
      closeIconSize: 20,
      closeInset: 8,
      closeHitSlop: 10,
    },
    switch: {
      ...(light.components?.switch || {}),
      trackOn: '#2E7BFF',
      trackOff: '#3A4250',
      trackOnDisabled: '#3B6FD6',
      trackOffDisabled: '#2A3140',
      iosBackgroundColor: '#2B3140',
    },
    header: {
      ...(light.components?.header || {}),
      edgePadding: 12,
    },
  },

  timings: {
    requestTimeoutMs: 12000,
    backDelayMs: 300,
    emailDebounceMs: 450,
    invalidInputWarningMs: 2200,
    postRegisterNavDelayMs: 500,
    presenceOnlineWindowMs: 120000,
    presenceFutureSkewMs: 300000,
    panelToggleMs: 220,
  },
};

export const tokens = { light, dark };
