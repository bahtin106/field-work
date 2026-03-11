import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';

import { BaseModal, ConfirmModal } from '../../../components/ui/modals';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';
import PhotoCaptureFlowModal from './PhotoCaptureFlowModal';
import PhotoGrid from './PhotoGrid';

const hapticTap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
const hapticMedium = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

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
  onRemoveMany,
  onOpenViewer,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const [cameraVisible, setCameraVisible] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedUris, setSelectedUris] = useState([]);
  const [confirmRemoveIndex, setConfirmRemoveIndex] = useState(null);

  useEffect(() => {
    if (!visible) {
      setSelectionMode(false);
      setSelectedUris([]);
      setConfirmRemoveIndex(null);
    }
  }, [visible]);

  useEffect(() => {
    setSelectionMode(false);
    setSelectedUris([]);
    setConfirmRemoveIndex(null);
  }, [category]);

  useEffect(() => {
    const actual = new Set((photos || []).map((value) => String(value)));
    setSelectedUris((prev) => prev.filter((value) => actual.has(String(value))));
  }, [photos]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedUris([]);
  }, []);

  const enterSelectionMode = useCallback(
    (actualIndex) => {
      const nextUrl = String((photos || [])[actualIndex] || '').trim();
      if (!nextUrl) return;
      hapticMedium();
      setSelectionMode(true);
      setSelectedUris((prev) => (prev.includes(nextUrl) ? prev : [...prev, nextUrl]));
    },
    [photos],
  );

  const toggleSelection = useCallback(
    (actualIndex) => {
      const nextUrl = String((photos || [])[actualIndex] || '').trim();
      if (!nextUrl) return;
      hapticTap();
      setSelectedUris((prev) =>
        prev.includes(nextUrl) ? prev.filter((value) => value !== nextUrl) : [...prev, nextUrl],
      );
    },
    [photos],
  );

  const handleSaveFromCamera = useCallback(
    (uris) => {
      if (!uris || !uris.length) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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
    [category, onUploadMultiple, onUploadUri],
  );

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

      const uris = (result.assets || []).map((asset) => asset.uri).filter(Boolean);
      if (!uris.length) return;

      hapticMedium();
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
      setConfirmRemoveIndex(idx);
    },
    [],
  );

  const closeRemoveConfirm = useCallback(() => {
    setConfirmRemoveIndex(null);
  }, []);

  const confirmRemove = useCallback(() => {
    if (confirmRemoveIndex == null) return;
    hapticMedium();
    onRemove?.(category, confirmRemoveIndex);
  }, [category, confirmRemoveIndex, onRemove]);

  const handleOpenViewer = useCallback(
    (list, idx) => {
      if (idx >= 0 && onOpenViewer) onOpenViewer(list, idx);
    },
    [onOpenViewer],
  );

  const handleDeleteSelected = useCallback(() => {
    if (!selectedUris.length || !onRemoveMany) return;
    hapticMedium();
    onRemoveMany(category, selectedUris);
    exitSelectionMode();
  }, [category, exitSelectionMode, onRemoveMany, selectedUris]);

  const count = (photos || []).length;
  const unavailableCount = useMemo(
    () => (photos || []).filter((url) => !!getIssue?.(url)).length,
    [getIssue, photos],
  );
  const selectedCount = selectedUris.length;
  const deleteDisabled = selectedCount === 0;
  const s = useMemo(() => buildStyles(theme), [theme]);

  const footer = useMemo(() => {
    if (selectionMode) {
      return (
        <View style={s.footerWrap}>
          <Text style={s.footerLabel}>
            {t('order_photos_selected_hint', 'Выбрано {count}')
              .replace('{count}', String(selectedCount))}
          </Text>
          <View style={s.footerRow}>
            <Pressable
              onPress={handleDeleteSelected}
              disabled={deleteDisabled}
              style={({ pressed }) => [
                s.actionBtn,
                s.actionBtnDanger,
                deleteDisabled && s.actionBtnDisabled,
                pressed && !deleteDisabled && s.actionBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('order_photos_delete_selected', 'Удалить')}
            >
              <View style={s.actionBtnIcon}>
                <Feather name="trash-2" size={theme.icons?.sm ?? 18} color={theme.colors.onPrimary} />
              </View>
              <Text style={s.actionBtnText}>
                {t('order_photos_delete_selected', 'Удалить')}
              </Text>
            </Pressable>
            <Pressable
              onPress={exitSelectionMode}
              style={({ pressed }) => [s.actionBtn, pressed && s.actionBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel={t('common_cancel')}
            >
              <View style={s.actionBtnIcon}>
                <Feather name="x" size={theme.icons?.sm ?? 18} color={theme.colors.primary} />
              </View>
              <Text style={s.actionBtnTextSecondary}>
                {t('common_cancel')}
              </Text>
            </Pressable>
          </View>
        </View>
      );
    }

    return (
      <View style={s.footerWrap}>
        <Text style={s.footerLabel}>
          {t('order_photos_add_label', 'Добавить фото')}
        </Text>
        <View style={s.footerRow}>
          <Pressable
            onPress={handleOpenCamera}
            style={({ pressed }) => [s.actionBtn, pressed && s.actionBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={t('order_photo_source_camera', 'Камера')}
          >
            <View style={s.actionBtnIcon}>
              <Feather name="camera" size={theme.icons?.sm ?? 18} color={theme.colors.primary} />
            </View>
            <Text style={s.actionBtnTextSecondary} numberOfLines={1}>
              {t('order_photo_source_camera', 'Камера')}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleGallery}
            style={({ pressed }) => [s.actionBtn, pressed && s.actionBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={t('order_photo_source_gallery', 'Галерея')}
          >
            <View style={s.actionBtnIcon}>
              <Feather name="image" size={theme.icons?.sm ?? 18} color={theme.colors.primary} />
            </View>
            <Text style={s.actionBtnTextSecondary} numberOfLines={1}>
              {t('order_photo_source_gallery', 'Галерея')}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }, [
    deleteDisabled,
    exitSelectionMode,
    handleDeleteSelected,
    handleGallery,
    handleOpenCamera,
    s,
    selectedCount,
    selectionMode,
    t,
    theme,
  ]);

  return (
    <>
      <BaseModal
        visible={visible}
        onClose={onClose}
        title={t('order_photos_title', 'Фотографии')}
        maxHeightRatio={0.85}
        footer={footer}
      >
        <Text style={s.subtitle}>
          {selectionMode
            ? t('order_photos_selected_hint', 'Выбрано {count}').replace('{count}', String(selectedCount))
            : t('order_photos_count', '{count} фото').replace('{count}', String(count))}
        </Text>
        {unavailableCount > 0 ? (
          <Text style={s.warningText}>
            {t('order_photos_unavailable_hint').replace('{count}', String(unavailableCount))}
          </Text>
        ) : null}

        <PhotoGrid
          photos={photos}
          pending={pending}
          getDisplayUrl={getDisplayUrl}
          getIssue={getIssue}
          onOpenViewer={handleOpenViewer}
          onRemove={handleRemove}
          selectionMode={selectionMode}
          selectedUris={selectedUris}
          onEnterSelectionMode={enterSelectionMode}
          onToggleSelect={toggleSelection}
        />
      </BaseModal>

      <PhotoCaptureFlowModal
        visible={cameraVisible}
        onClose={handleCloseCamera}
        onSave={handleSaveFromCamera}
      />

      <ConfirmModal
        visible={confirmRemoveIndex != null}
        onClose={closeRemoveConfirm}
        title={t('order_photos_delete_single_title')}
        message={t('order_photos_delete_single_message')}
        confirmLabel={t('order_photos_delete_single_confirm')}
        cancelLabel={t('order_photos_delete_single_cancel')}
        confirmVariant="destructive"
        onConfirm={confirmRemove}
      />
    </>
  );
}

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
    actionBtn: {
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
    actionBtnDanger: {
      backgroundColor: cl.danger,
      borderColor: cl.danger,
    },
    actionBtnDisabled: {
      opacity: 0.45,
    },
    actionBtnPressed: {
      opacity: 0.75,
    },
    actionBtnIcon: {
      width: theme.icons?.md ?? 22,
      height: theme.icons?.md ?? 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionBtnText: {
      fontSize: ty.sizes.md,
      fontWeight: ty.weight?.semibold || '600',
      color: cl.onPrimary,
    },
    actionBtnTextSecondary: {
      fontSize: ty.sizes.md,
      fontWeight: ty.weight?.semibold || '600',
      color: cl.primary,
    },
  });
}
