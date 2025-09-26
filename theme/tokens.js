// theme/tokens.js
const light = {
  colors: {
    background: "#F2F2F7",
    surface: "#FFFFFF",
    text: "#0A0A0A",
    textSecondary: "#6B7280",
    muted: "#6B7280",
    primary: "#007AFF",
    onPrimary: "#FFFFFF",
    primaryTextOn: "#FFFFFF",
    border: "#E5E7EB",
    success: "#22C55E",
    warning: "#F59E0B",
    worker: "#5856D6",
    danger: "#FF3B30",
    overlay: "rgba(0,0,0,0.35)",
    overlayNavBar: "rgba(0,0,0,0.25)",
    inputBg: "#FFFFFF",
    inputPlaceholder: "#9CA3AF",
    inputBorder: "#E5E7EB",
    cardShadow: "rgba(0,0,0,0.06)",

    button: {
      primaryBg: "#007AFF",
      primaryText: "#FFFFFF",
      secondaryBg: "#EEF1F6",
      secondaryText: "#0A0A0A",
      dangerBg: "#FF3B30",
      dangerText: "#FFFFFF"
    },
    status: {
      feed:     { bg: "#FFF7CC", fg: "#8A6D1F" },
      new:      { bg: "#E8F0FE", fg: "#0A84FF" },
      progress: { bg: "#E9F7EF", fg: "#34C759" },
      done:     { bg: "#F2F2F7", fg: "#6B7280" }
    },
    chipBg: "#E6F0FF",
    badgeBg: "#EEF1F6",
    primaryDisabled: "#9DC6FF",
    navigationBarBg: "#FFFFFF",
    bannerBg: "#E6F0FF"
},
  radii: { xs: 6, sm: 8, md: 10, lg: 12, xl: 16, pill: 999 },
  spacing: { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, xxl: 32 },
  typography: {
    fontFamily: "System",
    sizes: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, xxl: 28, display: 34 },
    lineHeights: { tight: 1.1, normal: 1.35, relaxed: 1.5 },
    weight: { regular: "400", medium: "500", semibold: "600", bold: "700" },
  },
  shadows: {
    card: { ios: { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 2 } },
    raised: { ios: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }, android: { elevation: 3 } },
  },
  icons: { sm: 18, md: 22, lg: 28 },
components: {
  card: { borderWidth: 1 },
  listItem: { height: 48, dividerWidth: 1, disabledOpacity: 0.5, chevronSize: 20 }
},
};

const dark = {
  ...light,
  colors: {
    ...light.colors,
    background: "#0B0B0F",
    surface: "#121218",
    text: "#F3F4F6",
    textSecondary: "#A3A3A3",
    muted: "#A3A3A3",
    worker: "#7C7CF0",
    border: "#23252B",
    inputBg: "#161823",
    inputBorder: "#262A34",
    cardShadow: "rgba(0,0,0,0.5)",
    overlay: "rgba(0,0,0,0.6)",
    overlayNavBar: "rgba(0,0,0,0.45)",

    button: {
      primaryBg: "#2F6FFF",
      primaryText: "#FFFFFF",
      secondaryBg: "#161823",
      secondaryText: "#F3F4F6",
      dangerBg: "#FF453A",
      dangerText: "#FFFFFF"
    },
    status: {
      feed:     { bg: "#2B2414", fg: "#EBCB6E" },
      new:      { bg: "#0F1B2D", fg: "#64A3FF" },
      progress: { bg: "#0F2317", fg: "#34C759" },
      done:     { bg: "#1A1C22", fg: "#A3A3A3" }
    },
    chipBg: "#1C2333",
    badgeBg: "#1E2433",
    primaryDisabled: "#3A6FD9",
    navigationBarBg: "#121218",
    bannerBg: "#1C2333"
},
  shadows: {
    card: { ios: { shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } }, android: { elevation: 4 } },
    raised: { ios: { shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 22, shadowOffset: { width: 0, height: 14 } }, android: { elevation: 6 } },
  },
};

export const tokens = { light, dark };
