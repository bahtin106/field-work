import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';

import { BaseModal, ConfirmModal } from '../../../components/ui/modals';
import { useToast } from '../../../components/ui/ToastProvider';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';
import PhotoCaptureFlowModal from './PhotoCaptureFlowModal';
import PhotoGrid from './PhotoGrid';

const hapticTap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
const hapticMedium = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

const getImagePickerMediaTypesImages = () => {
  if (ImagePicker.MediaType?.Images) return ImagePicker.MediaType.Images;
  if (ImagePicker.MediaType?.images) return ImagePicker.MediaType.images;
  if (ImagePicker.MediaType?.image) return ImagePicker.MediaType.image;
  return ['images'];
};

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
  suspended = false,
  onDismiss,
  canAddFromCamera = true,
  canAddFromGallery = true,
  canRemovePhotos = true,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();

  const [cameraVisible, setCameraVisible] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedUris, setSelectedUris] = useState([]);
  const [confirmRemoveIndex, setConfirmRemoveIndex] = useState(null);
  const [removeConfirmVisible, setRemoveConfirmVisible] = useState(false);
  const pickedSessionIdsRef = useRef(new Set());
  const removeConfirmResetTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (removeConfirmResetTimerRef.current) clearTimeout(removeConfirmResetTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!visible) {
      setSelectionMode(false);
      setSelectedUris([]);
      setConfirmRemoveIndex(null);
      setRemoveConfirmVisible(false);
      pickedSessionIdsRef.current = new Set();
    }
  }, [pickedSessionIdsRef, visible]);

  useEffect(() => {
    if (!canAddFromCamera && cameraVisible) setCameraVisible(false);
  }, [cameraVisible, canAddFromCamera]);

  useEffect(() => {
    if (!canRemovePhotos && selectionMode) {
      setSelectionMode(false);
      setSelectedUris([]);
    }
  }, [canRemovePhotos, selectionMode]);

  useEffect(() => {
    setSelectionMode(false);
    setSelectedUris([]);
    setConfirmRemoveIndex(null);
    setRemoveConfirmVisible(false);
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
      if (!canAddFromCamera) return;
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
    [canAddFromCamera, category, onUploadMultiple, onUploadUri],
  );

  const handleGallery = useCallback(async () => {
    if (!canAddFromGallery) return;
    hapticTap();
    try {
      let perm = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!perm?.granted) {
        perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      }
      if (!perm?.granted) {
        toast.error(t('order_no_gallery_permission'));
        return;
      }

      let result;
      try {
        const mediaTypes = getImagePickerMediaTypesImages();
        result = await ImagePicker.launchImageLibraryAsync({
          quality: theme.media?.quality ?? 1,
          allowsMultipleSelection: true,
          mediaTypes,
          orderedSelection: true,
          selectionLimit: 20,
        });
      } catch (multiSelectError) {
        console.warn('[OrderPhotosModal] gallery multi-select failed, fallback to single pick', multiSelectError);
        const mediaTypes = getImagePickerMediaTypesImages();
        result = await ImagePicker.launchImageLibraryAsync({
          quality: theme.media?.quality ?? 1,
          allowsMultipleSelection: false,
          mediaTypes,
        });
      }
      if (!result || result.canceled) return;

      if (!(result.assets || []).length) return;

      const next = [];
      for (const asset of result.assets || []) {
        const uri = String(asset?.uri || '').trim();
        if (!uri) continue;
        const id = String(asset?.assetId || uri);
        if (pickedSessionIdsRef.current.has(id)) continue;
        pickedSessionIdsRef.current.add(id);
        next.push(uri);
      }
      if (!next.length) return;

      hapticMedium();
      onUploadMultiple(category, next).catch((e) =>
        console.warn('[OrderPhotosModal] gallery upload error', e),
      );
    } catch (e) {
      console.warn('[OrderPhotosModal] gallery picker error', e);
      toast.error(t('toast_error'));
    }
  }, [canAddFromGallery, category, onUploadMultiple, pickedSessionIdsRef, t, theme.media?.quality, toast]);

  const handleOpenCamera = useCallback(() => {
    if (!canAddFromCamera) return;
    hapticMedium();
    setCameraVisible(true);
  }, [canAddFromCamera]);

  const handleCloseCamera = useCallback(() => {
    setCameraVisible(false);
  }, []);

  const handleRemove = useCallback(
    (idx) => {
      if (!canRemovePhotos) return;
      if (removeConfirmResetTimerRef.current) clearTimeout(removeConfirmResetTimerRef.current);
      setConfirmRemoveIndex(idx);
      setRemoveConfirmVisible(false);
    },
    [canRemovePhotos],
  );

  const closeRemoveConfirm = useCallback(() => {
    setRemoveConfirmVisible(false);
    if (removeConfirmResetTimerRef.current) clearTimeout(removeConfirmResetTimerRef.current);
    removeConfirmResetTimerRef.current = setTimeout(() => {
      setConfirmRemoveIndex(null);
      removeConfirmResetTimerRef.current = null;
    }, 280);
  }, []);

  const confirmRemove = useCallback(() => {
    if (confirmRemoveIndex == null) return;
    hapticMedium();
    onRemove?.(category, confirmRemoveIndex);
    setConfirmRemoveIndex(null);
    setRemoveConfirmVisible(false);
  }, [category, confirmRemoveIndex, onRemove]);

  const handleBaseDismiss = useCallback(() => {
    if (confirmRemoveIndex != null && !removeConfirmVisible) {
      setRemoveConfirmVisible(true);
      return;
    }
    onDismiss?.();
  }, [confirmRemoveIndex, onDismiss, removeConfirmVisible]);

  const handleOpenViewer = useCallback(
    (list, idx) => {
      if (idx >= 0 && onOpenViewer) onOpenViewer(list, idx);
    },
    [onOpenViewer],
  );

  const handleDeleteSelected = useCallback(() => {
    if (!selectedUris.length || !onRemoveMany) return;
    if (!canRemovePhotos) return;
    hapticMedium();
    onRemoveMany(category, selectedUris);
    exitSelectionMode();
  }, [canRemovePhotos, category, exitSelectionMode, onRemoveMany, selectedUris]);

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

    if (!canAddFromCamera && !canAddFromGallery) return null;

    return (
      <View style={s.footerWrap}>
        <View style={s.footerRow}>
          <Pressable
            onPress={handleOpenCamera}
            style={({ pressed }) => [
              s.actionBtn,
              !canAddFromCamera && s.hidden,
              pressed && s.actionBtnPressed,
            ]}
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
            style={({ pressed }) => [
              s.actionBtn,
              !canAddFromGallery && s.hidden,
              pressed && s.actionBtnPressed,
            ]}
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
    canAddFromCamera,
    canAddFromGallery,
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
        visible={visible && !suspended && confirmRemoveIndex == null}
        onClose={suspended || confirmRemoveIndex != null ? undefined : onClose}
        onDismiss={handleBaseDismiss}
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
          onRemove={canRemovePhotos ? handleRemove : undefined}
          canAddPhotos={canAddFromCamera || canAddFromGallery}
          selectionMode={selectionMode}
          selectedUris={selectedUris}
          onEnterSelectionMode={canRemovePhotos ? enterSelectionMode : undefined}
          onToggleSelect={canRemovePhotos ? toggleSelection : undefined}
        />
      </BaseModal>

      <PhotoCaptureFlowModal
        visible={cameraVisible && canAddFromCamera}
        onClose={handleCloseCamera}
        onSave={handleSaveFromCamera}
      />

      <ConfirmModal
        visible={removeConfirmVisible}
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
    hidden: {
      display: 'none',
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
