// app/app_settings/AppSettings.jsx
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Switch,
  ScrollView,
  Modal,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AppHeader from "../../components/navigation/AppHeader";
import { useNavigation } from "expo-router";
import { useRoute } from "@react-navigation/native";
import FeatherIcon from "@expo/vector-icons/Feather";
import { useTheme } from "../../theme";
import { useToast } from "../../components/ui/ToastProvider";

export default function AppSettings() {
  const nav = useNavigation();
  const route = useRoute();
  const { theme, mode, setMode } = useTheme();
  const toast = useToast();
  const [themeOpen, setThemeOpen] = useState(false);

  const s = useMemo(() => styles(theme), [theme]);
  const futureFeature = () => toast.info("Будет добавлено в будущем");

  const sections = [
    {
      key: "appearance",
      title: "ВНЕШНИЙ ВИД",
      items: [
        {
          key: "theme",
          label: "Тема",
          right: <Text style={[s.value, { color: theme.colors.text }]}>{mode === "system" ? "Системная" : mode === "light" ? "Светлая" : "Тёмная"}</Text>,
          chevron: true,
          onPress: () => setThemeOpen(true),
        },
        { key: "text-size", label: "Размер текста", chevron: true, disabled: true, onPress: futureFeature },
        { key: "bold-text", label: "Жирный текст", switch: true, disabled: true, onPress: futureFeature },
      ],
    },
    {
      key: "notifications",
      title: "УВЕДОМЛЕНИЯ",
      items: [
        { key: "allow", label: "Допускать уведомления", switch: true, disabled: true, onPress: futureFeature },
        { key: "sounds", label: "Звуки уведомлений", chevron: true, disabled: true, onPress: futureFeature },
        { key: "events", label: "Включенные события", chevron: true, disabled: true, onPress: futureFeature },
      ],
    },
    {
      key: "privacy",
      title: "ПРИВАТНОСТЬ",
      items: [
        { key: "geo", label: "Сервисы геолокации", chevron: true, disabled: true, onPress: futureFeature },
        { key: "analytics", label: "Анализ функционала", chevron: true, disabled: true, onPress: futureFeature },
        { key: "private-search", label: "Конфиденциальный поиск", switch: true, disabled: true, onPress: futureFeature },
      ],
    },
    {
      key: "ai",
      title: "AI",
      items: [
        { key: "suggestions", label: "Персональные предложения", chevron: true, disabled: true, onPress: futureFeature },
        { key: "avatars", label: "Аватарки AI", switch: true, disabled: true, onPress: futureFeature },
      ],
    },
  ];

  return (
    <SafeAreaView edges={['left','right']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView showsVerticalScrollIndicator={false}>
                <AppHeader options={{ title: "Настройки приложения" }} back={nav.canGoBack()} route={route} />
{sections.map((sec) => (
          <View key={sec.key} style={s.sectionWrap}>
            <Text style={[s.sectionTitle, { color: theme.colors.textSecondary }]}>{sec.title}</Text>
            <View style={[s.card, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
              {sec.items.map((it, idx) => {
                const last = idx === sec.items.length - 1;
                const row = (
                  <View style={[s.row, !last && [s.rowDivider, { borderColor: theme.colors.border }], it.disabled && s.disabled]}>
                    <Text style={[s.label, { color: theme.colors.text }]}>{it.label}</Text>
                    <View style={s.rightWrap}>
                      {it.switch ? (
                        <>
                          <Switch
                            value={false}
                            disabled
                            trackColor={{ true: theme.colors.primary }}
                          />
                          <View style={s.chevronSpacer} />
                        </>
                      ) : it.right ? (
                        it.right
                      ) : null}
                      {(it.chevron || !it.switch) && (
                        <FeatherIcon name="chevron-right" size={20} color={theme.colors.textSecondary} style={s.chevron} />
                      )}
                    </View>
                  </View>
                );
                return (
                  <Pressable
                    key={it.key}
                    onPress={it.onPress}
                    android_ripple={{ color: theme.colors.ripple, borderless: false }}
                  >
                    {row}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Theme picker modal */}
      <Modal visible={themeOpen} animationType="slide" transparent onRequestClose={() => setThemeOpen(false)}>
        <Pressable style={[s.modalBackdrop, { backgroundColor: theme.colors.overlay }]} onPress={() => setThemeOpen(false)}>
          <Pressable style={[s.sheet, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[s.sheetTitle, { color: theme.colors.text }]}>Тема</Text>
            {["light","dark","system"].map((opt, i) => {
              const labels = { light: "Светлая", dark: "Тёмная", system: "Системная" };
              const active = mode === opt;
              return (
                <Pressable
                  key={opt}
                  onPress={() => { setMode(opt); setThemeOpen(false); }}
                  style={[s.sheetRow, i < 2 && [s.rowDivider, { borderColor: theme.colors.border }]]}
                >
                  <Text style={[s.sheetLabel, { color: theme.colors.text }]}>{labels[opt]}</Text>
                  {active && <FeatherIcon name="check" size={18} color={theme.colors.primary} />}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = (t) => StyleSheet.create({
  sectionWrap: { marginBottom: t.spacing.lg },
  sectionTitle: {
    fontSize: t.typography.sizes.xs,
    fontWeight: "700",
    marginBottom: t.spacing.sm,
    paddingLeft: t.spacing.xl,
    paddingRight: t.spacing.lg,
    textTransform: "uppercase",
  },
  card: {
    marginHorizontal: t.spacing.lg,
    marginTop: 0,
    marginBottom: 0,
    borderRadius: t.radii.xl,
    overflow: "hidden",
    borderWidth: 1,
    ...(Platform.OS === "ios" ? t.shadows.card.ios : t.shadows.card.android),
  },
  row: {
    height: 48,
    paddingLeft: t.spacing.xl,
    paddingRight: t.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: t.colors.card,
  },
  rowDivider: { borderBottomWidth: 1 },
  disabled: { opacity: 0.5 },
  label: { fontSize: t.typography.sizes.md, fontWeight: "500" },
  value: { fontSize: t.typography.sizes.md },
  rightWrap: { flexDirection: "row", alignItems: "center" },

  // Modal bottom-sheet
  modalBackdrop: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  sheet: {
    width: "100%",
    borderTopLeftRadius: t.radii.xl,
    borderTopRightRadius: t.radii.xl,
    overflow: "hidden",
    borderWidth: 1,
    paddingBottom: t.spacing.sm,
  },
  sheetTitle: { fontSize: t.typography.sizes.md, fontWeight: "700", paddingLeft: t.spacing.xl,
    paddingRight: t.spacing.lg, paddingTop: t.spacing.md, paddingBottom: t.spacing.xs },
  sheetRow: {
    height: 48,
    paddingLeft: t.spacing.xl,
    paddingRight: t.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: t.colors.surface,
  },
  sheetLabel: { fontSize: t.typography.sizes.md },
});