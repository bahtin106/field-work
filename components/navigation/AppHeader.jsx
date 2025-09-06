// components/navigation/AppHeader.jsx
import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, ActivityIndicator, Modal, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { useSafeAreaInsets, SafeAreaView } from "react-native-safe-area-context";
import { logEvent, logError } from "../feedback/telemetry"; // telemetry hooks
import { supabase } from "../../lib/supabase"; // client

export default function AppHeader({ options, back }) {
  const { theme } = useTheme();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  // inline form state
  const [text, setText] = useState("");
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);
  const canSend = text.trim().length >= 10 && !sending;

  async function submitFeedback() {
    if (!canSend) return;
    setSending(true);
    try {
      // Сервер сам подтянет user_id, email, phone, full_name из JWT/профиля
      const { data, error } = await supabase.rpc('create_feedback_enriched', {
        p_text: text.trim(),
        p_contact: contact.trim() || null,
      });
      if (error) throw error;
      logEvent("feedback_submitted", { ok: true, id: data });
      setText("");
      setContact("");
      setOpen(false);
    } catch (e) {
      logError(e, { where: "AppHeader.submitFeedback" });
      logEvent("feedback_submit_failed", { message: String(e?.message || e) });
      Alert.alert("Не удалось отправить", e?.message || "Ошибка при отправке отзыва");
      console.warn("Feedback submit failed:", e);
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={[s.container, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border }]}>
      <View style={s.left}>
        {back ? (
          <Pressable hitSlop={12} style={s.back} onPress={() => nav.goBack()}>
            <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
          </Pressable>
        ) : null}
      </View>
      <View style={s.center}>
        <Text numberOfLines={1} style={[s.title, { color: theme.colors.text }]}>{options?.title ?? ""}</Text>
      </View>
      <View style={s.right}>
        {options?.headerRight ? (
          options.headerRight()
        ) : (
          <Pressable hitSlop={12} onPress={() => { setOpen(true); logEvent("feedback_open"); }}>
            <Text style={{ color: theme.colors.primary, fontWeight: "600" }}>Отзыв</Text>
          </Pressable>
        )}
      </View>

      {/* Polished Modal */}
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={[s.modalOverlay, { backgroundColor: theme.colors.overlay }]} edges={['top','left','right']}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <View style={[s.sheet, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <View style={s.sheetHeader}>
                <Text style={[s.sheetTitle, { color: theme.colors.text }]}>Сообщить о проблеме</Text>
                <Pressable hitSlop={12} onPress={() => setOpen(false)}>
                  <Text style={{ color: theme.colors.textSecondary, fontWeight: "600" }}>Закрыть</Text>
                </Pressable>
              </View>

              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Что случилось? (минимум 10 символов)"
                placeholderTextColor={theme.colors.inputPlaceholder}
                multiline
                numberOfLines={6}
                style={[s.input, { borderColor: theme.colors.inputBorder, backgroundColor: theme.colors.inputBg, color: theme.colors.text, minHeight: 120 }]}
              />
              <TextInput
                value={contact}
                onChangeText={setContact}
                placeholder="Как с вами связаться (email/telegram), необязательное поле"
                placeholderTextColor={theme.colors.inputPlaceholder}
                style={[s.input, { borderColor: theme.colors.inputBorder, backgroundColor: theme.colors.inputBg, color: theme.colors.text, height: 46 }]}
              />

              <View style={s.row}>
                <Pressable style={[s.btn, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} onPress={() => setOpen(false)}>
                  <Text style={{ color: theme.colors.text, fontWeight: "600" }}>Отмена</Text>
                </Pressable>
                <Pressable
                  onPress={submitFeedback}
                  disabled={!canSend}
                  style={[
                    s.btn,
                    { backgroundColor: canSend ? theme.colors.primary : theme.colors.primary + "66", borderColor: theme.colors.primary },
                  ]}
                >
                  {sending ? <ActivityIndicator /> : <Text style={{ color: theme.colors.primaryTextOn, fontWeight: "700" }}>Отправить</Text>}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { height: 56, flexDirection: "row", alignItems: "center", borderBottomWidth: 1 },
  left: { width: 64, alignItems: "flex-start", paddingLeft: 8 },
  right: { width: 64, alignItems: "flex-end", paddingRight: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "600" },
  back: { padding: 6, borderRadius: 12 },

  modalOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 12, // safe area already applied via edges
    paddingHorizontal: 16,
  },
  sheet: {
    width: "100%",
    maxWidth: 640,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    // subtle shadow
    shadowColor: "#000",
    shadowOpacity: Platform.OS === "ios" ? 0.15 : 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sheetTitle: { fontSize: 18, fontWeight: "700" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10, textAlignVertical: "top" },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 14 },
  btn: { height: 46, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
