// app/orders/components/OrderPhotosModal.jsx
// ────────────────────────────────────────────────────────────────────
// Photo management modal — built on top of the shared BaseModal.
// Uses the same UI primitives (BaseModal, Button) as every other
// modal in the app. Zero custom chrome.
// ────────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { BaseModal } from '../../../components/ui/modals';
import PhotoCaptureFlowModal from './PhotoCaptureFlowModal';
import PhotoGrid from './PhotoGrid';

// ─── Haptic helpers ───────────────────────────────────────────────
const hapticTap = () =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
const hapticMedium = () =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

/**
 * Bottom-sheet modal for viewing / adding / removing photos of one category.
 * Delegates all modal chrome (handle, header, close, backdrop, animation)
 * to BaseModal — keeps OrderPhotosModal focused on domain logic only.
 */
export default function OrderPhotosModal({
  visible,
  onClose,
  category,
  photos = [],
  pending = [],
  getDisplayUrl,
  getIssue,
  onUploadUri,
  onUploadMultiple,
  onRemove,
  onOpenViewer,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const [cameraVisible, setCameraVisible] = useState(false);

  // ── Camera: batch save → stay in modal, upload in background ──
  const handleSaveFromCamera = useCallback(
    (uris) => {
      if (!uris || !uris.length) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Fire-and-forget: uploads happen in parent scope
      if (uris.length === 1) {
        onUploadUri(category, uris[0]).catch((e) =>
          console.warn('[OrderPhotosModal] camera upload error', e),
        );
      } else {
        onUploadMultiple(category, uris).catch((e) =>
          console.warn('[OrderPhotosModal] camera batch upload error', e),
        );
      }
    },
    [category, onUploadUri, onUploadMultiple],
  );

  // ── Gallery: pick → stay in modal, upload in background ──────
  const handleGallery = useCallback(async () => {
    hapticTap();
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        quality: theme.media?.quality ?? 1,
        allowsMultipleSelection: true,
        mediaTypes: ['images'],
        orderedSelection: true,
        selectionLimit: 20,
      });
      if (!result || result.canceled) return;

      const uris = (result.assets || []).map((a) => a.uri).filter(Boolean);
      if (!uris.length) return;

      hapticMedium();
      // Fire-and-forget
      onUploadMultiple(category, uris).catch((e) =>
        console.warn('[OrderPhotosModal] gallery upload error', e),
      );
    } catch (e) {
      console.warn('[OrderPhotosModal] gallery picker error', e);
    }
  }, [category, onUploadMultiple, theme.media?.quality]);

  const handleOpenCamera = useCallback(() => {
    hapticMedium();
    setCameraVisible(true);
  }, []);

  const handleCloseCamera = useCallback(() => {
    setCameraVisible(false);
  }, []);

  const handleRemove = useCallback(
    (idx) => {
      hapticMedium();
      onRemove?.(category, idx);
    },
    [category, onRemove],
  );

  const handleOpenViewer = useCallback(
    (list, idx) => {
      if (idx >= 0 && onOpenViewer) onOpenViewer(list, idx);
    },
    [onOpenViewer],
  );

  const count = (photos || []).length;
  const unavailableCount = useMemo(
    () => (photos || []).filter((url) => !!getIssue?.(url)).length,
    [getIssue, photos],
  );

  const s = useMemo(() => buildStyles(theme), [theme]);

  // ── Footer: "Add photos" section with icon buttons ─────────
  const footer = useMemo(
    () => (
      <View style={s.footerWrap}>
        <Text style={s.footerLabel}>
          {t('order_photos_add_label', 'Добавить фото')}
        </Text>
        <View style={s.footerRow}>
          <Pressable
            onPress={handleOpenCamera}
            style={({ pressed }) => [s.addBtn, pressed && s.addBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={t('order_photo_source_camera', 'Камера')}
          >
            <View style={s.addBtnIcon}>
              <Feather name="camera" size={theme.icons?.sm ?? 18} color={theme.colors.primary} />
            </View>
            <Text style={s.addBtnText} numberOfLines={1}>
              {t('order_photo_source_camera', 'Камера')}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleGallery}
            style={({ pressed }) => [s.addBtn, pressed && s.addBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={t('order_photo_source_gallery', 'Галерея')}
          >
            <View style={s.addBtnIcon}>
              <Feather name="image" size={theme.icons?.sm ?? 18} color={theme.colors.primary} />
            </View>
            <Text style={s.addBtnText} numberOfLines={1}>
              {t('order_photo_source_gallery', 'Галерея')}
            </Text>
          </Pressable>
        </View>
      </View>
    ),
    [s, t, theme, handleOpenCamera, handleGallery],
  );

  return (
    <>
      <BaseModal
        visible={visible}
        onClose={onClose}
        title={t('order_photos_title', 'Фотографии')}
        maxHeightRatio={0.85}
        footer={footer}
      >
        {/* ── Subtitle (count) ── */}
        <Text style={s.subtitle}>
          {t('order_photos_count', '{count} фото').replace('{count}', String(count))}
        </Text>
        {unavailableCount > 0 ? (
          <Text style={s.warningText}>
            {t('order_photos_unavailable_hint').replace('{count}', String(unavailableCount))}
          </Text>
        ) : null}

        {/* ── Photo grid ── */}
        <PhotoGrid
          photos={photos}
          pending={pending}
          getDisplayUrl={getDisplayUrl}
          getIssue={getIssue}
          onOpenViewer={handleOpenViewer}
          onRemove={handleRemove}
        />
      </BaseModal>

      <PhotoCaptureFlowModal
        visible={cameraVisible}
        onClose={handleCloseCamera}
        onSave={handleSaveFromCamera}
      />
    </>
  );
}

// ─── Styles (only content-specific, chrome is BaseModal's job) ─────
function buildStyles(theme) {
  const sp = theme.spacing;
  const ty = theme.typography;
  const cl = theme.colors;
  const rd = theme.radii;

  return StyleSheet.create({
    subtitle: {
      fontSize: ty.sizes.sm,
      color: cl.textSecondary,
      marginBottom: sp.sm,
    },
    warningText: {
      fontSize: ty.sizes.sm,
      color: cl.warning || cl.primary,
      marginBottom: sp.sm,
    },
    footerWrap: {
      gap: sp.sm,
    },
    footerLabel: {
      fontSize: ty.sizes.xs,
      fontWeight: ty.weight?.semibold || '600',
      color: cl.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    footerRow: {
      flexDirection: 'row',
      gap: sp.md,
    },
    addBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: sp.xs,
      height: theme.components?.button?.sizes?.md?.h ?? 48,
      borderRadius: rd.lg,
      borderWidth: 1,
      borderColor: cl.border,
      backgroundColor: cl.surface,
    },
    addBtnPressed: {
      opacity: 0.7,
    },
    addBtnIcon: {
      width: theme.icons?.md ?? 22,
      height: theme.icons?.md ?? 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addBtnText: {
      fontSize: ty.sizes.md,
      fontWeight: ty.weight?.semibold || '600',
      color: cl.primary,
    },
  });
}
