import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';

import { BaseModal, ConfirmModal } from '../../../components/ui/modals';
import { useToast } from '../../../components/ui/ToastProvider';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';
import PhotoGrid from './PhotoGrid';

const PhotoCaptureFlowModal = lazy(() => import('./PhotoCaptureFlowModal'));
let imagePipelineModulePromise = null;

function loadImagePipelineModule() {
  if (!imagePipelineModulePromise) {
    imagePipelineModulePromise = import('../../../src/shared/media/imagePipeline');
  }
  return imagePipelineModulePromise;
}

const hapticTap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
const hapticMedium = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

export default function MediaUploadModal({
  visible,
  onClose,
  category,
  photos = [],
  pending = [],
  onRetryPending,
  getDisplayUrl,
  getThumbnailUrl,
  getFallbackUrl,
  getIssue,
  onUploadUri,
  onUploadMultiple,
  includeUploadMetadata = false,
  onRemove,
  onRemoveMany,
  onOpenViewer,
  suspended = false,
  onDismiss,
  canAddFromCamera = true,
  canAddFromGallery = true,
  canRemovePhotos = true,
  embedded = false,
  fullscreenContent = null,
  onFullscreenRequestClose,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();

  const [cameraVisible, setCameraVisible] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedUris, setSelectedUris] = useState([]);
  const [confirmRemoveIndex, setConfirmRemoveIndex] = useState(null);
  const [removeManyConfirmVisible, setRemoveManyConfirmVisible] = useState(false);
  const [pendingRemoveManyUris, setPendingRemoveManyUris] = useState([]);
  const pickedSessionIdsRef = useRef(new Set());

  useEffect(() => {
    if (!visible) {
      setSelectionMode(false);
      setSelectedUris([]);
      setConfirmRemoveIndex(null);
      setRemoveManyConfirmVisible(false);
      setPendingRemoveManyUris([]);
      pickedSessionIdsRef.current = new Set();
      setCameraVisible(false);
    }
  }, [pickedSessionIdsRef, visible]);

  useEffect(() => {
    if (!canAddFromCamera && cameraVisible) setCameraVisible(false);
  }, [cameraVisible, canAddFromCamera]);

  useEffect(() => {
    if (!canRemovePhotos && selectionMode) {
      setSelectionMode(false);
      setSelectedUris([]);
      setRemoveManyConfirmVisible(false);
      setPendingRemoveManyUris([]);
    }
  }, [canRemovePhotos, selectionMode]);

  useEffect(() => {
    setSelectionMode(false);
    setSelectedUris([]);
    setConfirmRemoveIndex(null);
    setRemoveManyConfirmVisible(false);
    setPendingRemoveManyUris([]);
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
    (uploads) => {
      if (!canAddFromCamera) return;
      if (!uploads || !uploads.length) return;
      const payload = includeUploadMetadata
        ? uploads
        : uploads.map((upload) => String(upload?.uri || upload || '').trim()).filter(Boolean);
      if (!payload.length) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (payload.length === 1) {
        onUploadUri(category, payload[0]).catch((e) =>
          console.warn('[MediaUploadModal] camera upload error', e),
        );
      } else {
        onUploadMultiple(category, payload).catch((e) =>
          console.warn('[MediaUploadModal] camera batch upload error', e),
        );
      }
    },
    [canAddFromCamera, category, includeUploadMetadata, onUploadMultiple, onUploadUri],
  );

  const handleGallery = useCallback(async () => {
    if (!canAddFromGallery) return;
    hapticTap();
    try {
      const { pickGalleryImages } = await loadImagePipelineModule();
      const picked = await pickGalleryImages({
        quality: 1,
        selectionLimit: 20,
        seenIds: pickedSessionIdsRef.current,
      });
      const next = picked
        .filter((asset) => asset?.uri)
        .map((asset) => ({ uri: asset.uri, mediaOrigin: 'device_library' }));
      if (!next.length) return;

      hapticMedium();
      const payload = includeUploadMetadata ? next : next.map((upload) => upload.uri);
      onUploadMultiple(category, payload).catch((e) =>
        console.warn('[MediaUploadModal] gallery upload error', e),
      );
    } catch (e) {
      console.warn('[MediaUploadModal] gallery picker error', e);
      toast.error(e?.code === 'media_library_permission_denied' ? t('order_no_gallery_permission') : t('toast_error'));
    }
  }, [canAddFromGallery, category, includeUploadMetadata, onUploadMultiple, pickedSessionIdsRef, t, toast]);

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
      setConfirmRemoveIndex(idx);
    },
    [canRemovePhotos],
  );

  const closeRemoveConfirm = useCallback(() => {
    setConfirmRemoveIndex(null);
  }, []);

  const confirmRemove = useCallback(() => {
    if (confirmRemoveIndex == null) return;
    hapticMedium();
    onRemove?.(category, confirmRemoveIndex);
    setConfirmRemoveIndex(null);
  }, [category, confirmRemoveIndex, onRemove]);

  const handleBaseDismiss = useCallback(() => {
    onDismiss?.();
  }, [onDismiss]);

  const handleOpenViewer = useCallback(
    (list, idx) => {
      if (idx >= 0 && onOpenViewer) onOpenViewer(list, idx);
    },
    [onOpenViewer],
  );

  const handleDeleteSelected = useCallback(() => {
    if (!selectedUris.length || !onRemoveMany) return;
    if (!canRemovePhotos) return;
    setPendingRemoveManyUris(selectedUris);
    setRemoveManyConfirmVisible(true);
  }, [canRemovePhotos, onRemoveMany, selectedUris]);

  const closeRemoveManyConfirm = useCallback(() => {
    setRemoveManyConfirmVisible(false);
    setPendingRemoveManyUris([]);
  }, []);

  const confirmRemoveMany = useCallback(() => {
    const nextUris = pendingRemoveManyUris.map((value) => String(value || '').trim()).filter(Boolean);
    if (!nextUris.length || !onRemoveMany || !canRemovePhotos) {
      closeRemoveManyConfirm();
      return;
    }
    hapticMedium();
    onRemoveMany(category, nextUris);
    setRemoveManyConfirmVisible(false);
    setPendingRemoveManyUris([]);
    exitSelectionMode();
  }, [
    canRemovePhotos,
    category,
    closeRemoveManyConfirm,
    exitSelectionMode,
    onRemoveMany,
    pendingRemoveManyUris,
  ]);

  const count = (photos || []).length;
  const unavailableCount = useMemo(
    () => (photos || []).filter((url) => !!getIssue?.(url)).length,
    [getIssue, photos],
  );
  const selectedCount = selectedUris.length;
  const deleteDisabled = selectedCount === 0;
  const s = useMemo(() => buildStyles(theme), [theme]);
  const confirmationMode = confirmRemoveIndex != null || removeManyConfirmVisible;
  const confirmationTitle = removeManyConfirmVisible
    ? t('order_photos_delete_many_title')
    : t('order_photos_delete_single_title');
  const confirmationMessage = removeManyConfirmVisible
    ? t('order_photos_delete_many_message').replace(
        '{count}',
        String(pendingRemoveManyUris.length),
      )
    : t('order_photos_delete_single_message');
  const closeConfirmation = removeManyConfirmVisible ? closeRemoveManyConfirm : closeRemoveConfirm;
  const confirmDeletion = removeManyConfirmVisible ? confirmRemoveMany : confirmRemove;

  const footer = useMemo(() => {
    if (selectionMode) {
      return (
        <View style={s.footerWrap}>
          <Text style={s.footerLabel}>
            {t('order_photos_selected_hint')
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
              accessibilityLabel={t('order_photos_delete_selected')}
            >
              <View style={s.actionBtnIcon}>
                <Feather name="trash-2" size={theme.icons?.sm ?? 18} color={theme.colors.onPrimary} />
              </View>
              <Text style={s.actionBtnText}>
                {t('order_photos_delete_selected')}
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
            accessibilityLabel={t('order_photo_source_camera')}
          >
            <View style={s.actionBtnIcon}>
              <Feather name="camera" size={theme.icons?.sm ?? 18} color={theme.colors.primary} />
            </View>
            <Text style={s.actionBtnTextSecondary} numberOfLines={1}>
              {t('order_photo_source_camera')}
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
            accessibilityLabel={t('order_photo_source_gallery')}
          >
            <View style={s.actionBtnIcon}>
              <Feather name="image" size={theme.icons?.sm ?? 18} color={theme.colors.primary} />
            </View>
            <Text style={s.actionBtnTextSecondary} numberOfLines={1}>
              {t('order_photo_source_gallery')}
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

  const photoContent = (
    <>
      <Text style={s.subtitle}>
        {t('order_photos_count').replace('{count}', String(count))}
      </Text>
      {unavailableCount > 0 ? (
        <Text style={s.warningText}>
          {t('order_photos_unavailable_hint').replace('{count}', String(unavailableCount))}
        </Text>
      ) : null}

      <PhotoGrid
        photos={photos}
        pending={pending}
        onRetryPending={onRetryPending}
        getDisplayUrl={getDisplayUrl}
        getThumbnailUrl={getThumbnailUrl}
        getFallbackUrl={getFallbackUrl}
        getIssue={getIssue}
        onOpenViewer={handleOpenViewer}
        onRemove={canRemovePhotos ? handleRemove : undefined}
        canAddPhotos={canAddFromCamera || canAddFromGallery}
        selectionMode={selectionMode}
        selectedUris={selectedUris}
        onEnterSelectionMode={canRemovePhotos ? enterSelectionMode : undefined}
        onToggleSelect={canRemovePhotos ? toggleSelection : undefined}
      />
    </>
  );
  return (
    <>
      <BaseModal
        embedded={embedded}
        visible={visible && !suspended}
        onClose={suspended ? undefined : onClose}
        onDismiss={handleBaseDismiss}
        title={t('order_photos_title')}
        maxHeightRatio={0.85}
        presentation="sheet"
        footer={footer}
        disableBackdropClose={confirmationMode}
        disablePanClose={confirmationMode}
        onFullscreenRequestClose={cameraVisible ? handleCloseCamera : onFullscreenRequestClose}
        fullscreenContent={
          cameraVisible && canAddFromCamera ? (
            <Suspense fallback={<View style={s.cameraLoading}><ActivityIndicator color={theme.colors.primary} /></View>}>
              <PhotoCaptureFlowModal
                visible
                onClose={handleCloseCamera}
                onSave={handleSaveFromCamera}
              />
            </Suspense>
          ) : fullscreenContent
        }
      >
        {photoContent}
      </BaseModal>
      <ConfirmModal
        visible={visible && !suspended && confirmationMode}
        title={confirmationTitle}
        message={confirmationMessage}
        cancelLabel={t('order_photos_delete_single_cancel')}
        confirmLabel={t('order_photos_delete_single_confirm')}
        confirmVariant="destructive"
        onClose={closeConfirmation}
        onConfirm={confirmDeletion}
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
    cameraLoading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: cl.background,
    },
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
      fontSize: ty.sizes.sm,
      fontWeight: ty.weight?.semibold || '600',
      color: cl.text,
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
