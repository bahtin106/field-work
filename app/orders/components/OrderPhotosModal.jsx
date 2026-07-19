import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BaseModal } from '../../../components/ui/modals';
import ModalActionsRow from '../../../components/ui/modals/ModalActionsRow';
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
  embedded = false,
  fullscreenContent = null,
  onFullscreenRequestClose,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const insets = useSafeAreaInsets();

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
    (uris) => {
      if (!canAddFromCamera) return;
      if (!uris || !uris.length) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (uris.length === 1) {
        onUploadUri(category, uris[0]).catch((e) =>
          console.warn('[MediaUploadModal] camera upload error', e),
        );
      } else {
        onUploadMultiple(category, uris).catch((e) =>
          console.warn('[MediaUploadModal] camera batch upload error', e),
        );
      }
    },
    [canAddFromCamera, category, onUploadMultiple, onUploadUri],
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
      const next = picked.map((asset) => asset.uri).filter(Boolean);
      if (!next.length) return;

      hapticMedium();
      onUploadMultiple(category, next).catch((e) =>
        console.warn('[MediaUploadModal] gallery upload error', e),
      );
    } catch (e) {
      console.warn('[MediaUploadModal] gallery picker error', e);
      toast.error(e?.code === 'media_library_permission_denied' ? t('order_no_gallery_permission') : t('toast_error'));
    }
  }, [canAddFromGallery, category, onUploadMultiple, pickedSessionIdsRef, t, toast]);

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
  const s = useMemo(() => buildStyles(theme, insets), [insets, theme]);
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

  const confirmationFooter = useMemo(
    () => (
      <ModalActionsRow
        actions={[
          {
            key: 'cancel',
            title: t('order_photos_delete_single_cancel'),
            variant: 'secondary',
            onPress: closeConfirmation,
          },
          {
            key: 'confirm',
            title: t('order_photos_delete_single_confirm'),
            variant: 'destructive',
            onPress: confirmDeletion,
          },
        ]}
      />
    ),
    [closeConfirmation, confirmDeletion, t],
  );

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
        {selectionMode
          ? t('order_photos_selected_hint').replace('{count}', String(selectedCount))
          : t('order_photos_count').replace('{count}', String(count))}
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
  const modalContent = confirmationMode ? (
    <View style={s.confirmationContent}>
      <View style={s.confirmationIcon}>
        <Feather name="trash-2" size={theme.icons?.lg ?? 28} color={theme.colors.danger} />
      </View>
      <Text style={s.confirmationMessage}>{confirmationMessage}</Text>
    </View>
  ) : photoContent;
  const modalFooter = confirmationMode ? confirmationFooter : footer;

  return (
    <>
      {embedded ? (
        cameraVisible && canAddFromCamera ? (
          <Suspense fallback={<View style={s.cameraLoading}><ActivityIndicator color={theme.colors.primary} /></View>}>
            <PhotoCaptureFlowModal visible onClose={handleCloseCamera} onSave={handleSaveFromCamera} />
          </Suspense>
        ) : (
          <View style={s.embeddedRoot}>
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
            <View style={s.embeddedSheet}>
              <View style={s.embeddedHandleHit}>
                <View style={s.embeddedHandle} />
              </View>
              <View style={s.embeddedHeader}>
                <View style={s.embeddedClose} />
                <Text style={s.embeddedTitle}>{confirmationMode ? confirmationTitle : t('order_photos_title')}</Text>
                <Pressable
                  onPress={confirmationMode ? closeConfirmation : onClose}
                  hitSlop={theme.spacing.md}
                  style={s.embeddedClose}
                  accessibilityRole="button"
                  accessibilityLabel={t('btn_close')}
                >
                  <Feather name="x" size={theme.icons?.md ?? 22} color={theme.colors.textSecondary} />
                </Pressable>
              </View>
              <View style={s.embeddedContent}>{modalContent}</View>
              {modalFooter ? <View style={s.embeddedFooter}>{modalFooter}</View> : null}
            </View>
          </View>
        )
      ) : (
        <BaseModal
        visible={visible && !suspended}
        onClose={suspended ? undefined : confirmationMode ? closeConfirmation : onClose}
        onDismiss={handleBaseDismiss}
        title={confirmationMode ? confirmationTitle : t('order_photos_title')}
        maxHeightRatio={0.85}
        footer={modalFooter}
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
        {modalContent}
      </BaseModal>
      )}
    </>
  );
}

function buildStyles(theme, insets) {
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
    embeddedRoot: {
      flex: 1,
      justifyContent: 'flex-end',
      paddingHorizontal: theme.components?.modal?.edgePadding ?? sp.md,
      paddingBottom: Math.max(sp.md, Number(insets?.bottom || 0) + sp.md),
      backgroundColor: cl.overlay,
    },
    embeddedSheet: {
      width: '100%',
      maxHeight: '85%',
      minHeight: 0,
      flexShrink: 1,
      overflow: 'hidden',
      borderRadius: theme.components?.modal?.radius ?? theme.radii.xl,
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: cl.border,
      backgroundColor: cl.surface,
      ...(Platform.OS === 'ios'
        ? (theme.shadows?.card?.ios || {})
        : (theme.shadows?.card?.android || {})),
    },
    embeddedHandleHit: {
      alignItems: 'center',
      paddingVertical: sp.md,
    },
    embeddedHandle: {
      width: theme.components?.modal?.handleWidth ?? 48,
      height: theme.components?.modal?.handleHeight ?? 5,
      borderRadius: theme.radii.xs,
      backgroundColor: cl.inputBorder,
    },
    embeddedHeader: {
      minHeight: theme.components?.input?.height ?? 48,
      paddingHorizontal: sp.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    embeddedClose: {
      width: theme.components?.input?.height ?? 48,
      height: theme.components?.input?.height ?? 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    embeddedTitle: {
      flex: 1,
      textAlign: 'center',
      color: cl.text,
      fontSize: ty.sizes.lg,
      fontWeight: ty.weight?.bold || '700',
    },
    embeddedContent: {
      flexShrink: 1,
      minHeight: 0,
      paddingHorizontal: sp.lg,
    },
    embeddedFooter: {
      paddingHorizontal: sp.lg,
      paddingTop: sp.sm,
      paddingBottom: sp.md,
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
    confirmationContent: {
      minHeight: sp.xxxl * 2,
      alignItems: 'center',
      justifyContent: 'center',
      gap: sp.lg,
      paddingHorizontal: sp.lg,
      paddingVertical: sp.xl,
    },
    confirmationIcon: {
      width: sp.xxxl,
      height: sp.xxxl,
      borderRadius: rd.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: cl.surfaceSecondary || cl.background,
    },
    confirmationMessage: {
      maxWidth: 420,
      textAlign: 'center',
      fontSize: ty.sizes.md,
      lineHeight: Math.round(ty.sizes.md * 1.45),
      color: cl.textSecondary,
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
