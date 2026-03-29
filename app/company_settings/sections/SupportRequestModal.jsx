import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Button from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/ToastProvider';
import { BaseModal, ConfirmModal } from '../../../components/ui/modals';
import TextField from '../../../components/ui/TextField';
import FullscreenImageViewer from '../../orders/components/FullscreenImageViewer';
import {
  createSupportRequest,
  SUPPORT_MESSAGE_MAX_LEN,
  SUPPORT_PHOTO_MAX_COUNT,
  SUPPORT_UNREAD_QUERY_KEY,
} from '../../../src/features/supportRequests/api';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const getImagePickerMediaTypesImages = () => {
  try {
    if (ImagePicker.MediaType && ImagePicker.MediaType.Images) return ImagePicker.MediaType.Images;
    if (ImagePicker.MediaType && ImagePicker.MediaType.images) return ImagePicker.MediaType.images;
    if (ImagePicker.MediaType && ImagePicker.MediaType.image) return ImagePicker.MediaType.image;
  } catch {}
  return ['images'];
};

export default function SupportRequestModal({ visible, onClose, profile }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [message, setMessage] = React.useState('');
  const [photos, setPhotos] = React.useState([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [confirmDiscardVisible, setConfirmDiscardVisible] = React.useState(false);
  const [confirmRemovePhotoVisible, setConfirmRemovePhotoVisible] = React.useState(false);
  const [pendingRemovePhotoIndex, setPendingRemovePhotoIndex] = React.useState(null);
  const [feedback, setFeedback] = React.useState(null);
  const [viewerVisible, setViewerVisible] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  const selectedPhotoIdsRef = React.useRef(new Set());

  const photoTileSize = React.useMemo(() => {
    const windowWidth = Number(Dimensions.get('window')?.width || 0);
    const gap = Number(theme.spacing?.sm || 8);
    const horizontalPadding =
      Number(theme.spacing?.md || 12) * 2 + Number(theme.spacing?.lg || 16) * 2;
    const available = Math.max(220, windowWidth - horizontalPadding);
    const raw = Math.floor((available - gap * 2) / 3);
    return Math.max(72, Math.min(raw, 108));
  }, [theme.spacing?.lg, theme.spacing?.md, theme.spacing?.sm]);

  const isDirty = React.useMemo(
    () => String(message || '').trim().length > 0 || photos.length > 0,
    [message, photos.length],
  );

  const reset = React.useCallback(() => {
    setMessage('');
    setPhotos([]);
    setSubmitting(false);
    setConfirmDiscardVisible(false);
    setConfirmRemovePhotoVisible(false);
    setPendingRemovePhotoIndex(null);
    setFeedback(null);
    setViewerVisible(false);
    setViewerIndex(0);
    selectedPhotoIdsRef.current = new Set();
  }, []);

  const closeWithoutConfirm = React.useCallback(
    (force = false) => {
      if (submitting && !force) return;
      reset();
      onClose?.();
    },
    [onClose, reset, submitting],
  );

  const handleCloseRequest = React.useCallback(() => {
    if (submitting) return;
    if (isDirty) {
      setConfirmDiscardVisible(true);
      return;
    }
    closeWithoutConfirm();
  }, [closeWithoutConfirm, isDirty, submitting]);

  const pickFromGallery = React.useCallback(async () => {
    const remaining = Math.max(0, SUPPORT_PHOTO_MAX_COUNT - photos.length);
    if (remaining <= 0) {
      toast.warning(
        t('support_request_photo_limit_reached').replace('{count}', String(SUPPORT_PHOTO_MAX_COUNT)),
      );
      return;
    }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm?.status !== 'granted') {
        setFeedback({ type: 'error', message: t('error_library_denied') });
        return;
      }

      const mediaTypesOpt = getImagePickerMediaTypesImages();
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: mediaTypesOpt,
        quality: typeof theme.media?.quality === 'number' ? theme.media.quality : 0.85,
        allowsEditing: false,
        allowsMultipleSelection: true,
        orderedSelection: true,
        selectionLimit: remaining,
      });

      if (result?.canceled) return;
      const incoming = Array.isArray(result?.assets) ? result.assets : [];
      if (!incoming.length) return;

      setPhotos((prev) => {
        const next = [...(Array.isArray(prev) ? prev : [])];
        const seen = new Set(next.map((item) => item?.id).filter(Boolean));
        for (const asset of incoming) {
          const uri = String(asset?.uri || '').trim();
          if (!uri) continue;
          const id = String(asset?.assetId || uri);
          if (seen.has(id) || selectedPhotoIdsRef.current.has(id)) continue;
          seen.add(id);
          selectedPhotoIdsRef.current.add(id);
          next.push({ id, uri });
          if (next.length >= SUPPORT_PHOTO_MAX_COUNT) break;
        }
        if (next.length > SUPPORT_PHOTO_MAX_COUNT) {
          toast.warning(
            t('support_request_photo_limit_reached').replace('{count}', String(SUPPORT_PHOTO_MAX_COUNT)),
          );
        }
        return next.slice(0, SUPPORT_PHOTO_MAX_COUNT);
      });
      setFeedback(null);
    } catch (error) {
      setFeedback({ type: 'error', message: String(error?.message || t('toast_generic_error')) });
    }
  }, [photos.length, t, theme.media?.quality, toast]);

  const requestRemovePhoto = React.useCallback((index) => {
    if (!Number.isInteger(index) || index < 0) return;
    setPendingRemovePhotoIndex(index);
    setConfirmRemovePhotoVisible(true);
  }, []);

  const removePhoto = React.useCallback(() => {
    const index = Number(pendingRemovePhotoIndex);
    if (!Number.isInteger(index) || index < 0) {
      setConfirmRemovePhotoVisible(false);
      setPendingRemovePhotoIndex(null);
      return;
    }
    setPhotos((prev) => {
      if (!Array.isArray(prev) || index >= prev.length) return prev;
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      const removedId = String(removed?.id || '').trim();
      if (removedId) selectedPhotoIdsRef.current.delete(removedId);
      return next;
    });
    setConfirmRemovePhotoVisible(false);
    setPendingRemovePhotoIndex(null);
  }, [pendingRemovePhotoIndex]);

  const send = React.useCallback(async () => {
    const trimmed = String(message || '').trim();
    if (!trimmed) {
      setFeedback({ type: 'warning', message: t('support_request_message_required') });
      return;
    }

    try {
      setSubmitting(true);
      setFeedback(null);
      const created = await createSupportRequest({
        message: trimmed,
        photoLocalUris: photos.map((item) => String(item?.uri || '').trim()).filter(Boolean),
        userId: profile?.id || profile?.user_id || null,
        companyId: profile?.company_id || null,
        contact: profile?.full_name || null,
        fullName: profile?.full_name || null,
      });

      const requestedPhotos = Number(created?._supportMeta?.requestedPhotos || 0);
      const uploadedPhotos = Number(created?._supportMeta?.uploadedPhotos || 0);
      queryClient.invalidateQueries({ queryKey: SUPPORT_UNREAD_QUERY_KEY });
      closeWithoutConfirm(true);
      setTimeout(() => {
        toast.success(t('support_request_sent'));
        if (requestedPhotos > uploadedPhotos) {
          toast.info(
            t('support_request_photos_partially_uploaded')
              .replace('{uploaded}', String(uploadedPhotos))
              .replace('{requested}', String(requestedPhotos)),
          );
        }
      }, 50);
    } catch (error) {
      const raw = String(error?.message || '').trim();
      if (raw && raw.startsWith('support_request_')) {
        setFeedback({ type: 'error', message: t(raw) });
      } else {
        setFeedback({ type: 'error', message: raw || t('support_request_send_error') });
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    closeWithoutConfirm,
    message,
    photos,
    profile?.company_id,
    profile?.full_name,
    profile?.id,
    profile?.user_id,
    queryClient,
    t,
    toast,
  ]);

  const photoUris = React.useMemo(
    () => photos.map((item) => String(item?.uri || '').trim()).filter(Boolean),
    [photos],
  );

  return (
    <>
    <BaseModal
        visible={visible}
        onClose={() => {}}
        onRequestClose={handleCloseRequest}
        title={t('support_request_modal_title')}
        maxHeightRatio={0.82}
        keyboardExtraPadding={theme.spacing?.md || 12}
        disableBackdropClose={confirmDiscardVisible || confirmRemovePhotoVisible}
        disablePanClose={confirmDiscardVisible || confirmRemovePhotoVisible}
        feedback={feedback}
        footer={
          <View style={styles(theme).footerRow}>
            <Pressable
              onPress={handleCloseRequest}
              disabled={submitting}
              style={({ pressed }) => [
                styles(theme).ghostButton,
                pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
                submitting ? { opacity: theme.components.listItem.disabledOpacity } : null,
              ]}
            >
              <Text style={styles(theme).ghostButtonText}>{t('btn_cancel')}</Text>
            </Pressable>
            <Button
              variant="primary"
              size="md"
              title={submitting ? t('btn_sending') : t('btn_send')}
              disabled={submitting || !String(message || '').trim()}
              onPress={send}
            />
          </View>
        }
      >
        <ScrollView
          style={styles(theme).scroll}
          contentContainerStyle={styles(theme).contentWrap}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator={false}
        >
          <TextField
            value={message}
            onChangeText={setMessage}
            placeholder={t('support_request_message_placeholder')}
            multiline
            minLines={3}
            maxLines={8}
            maxLength={SUPPORT_MESSAGE_MAX_LEN}
            returnKeyType="default"
          />

          <View style={styles(theme).counterWrap}>
            <Text style={styles(theme).counterText}>{`${String(message || '').length}/${SUPPORT_MESSAGE_MAX_LEN}`}</Text>
          </View>

          <View style={styles(theme, photoTileSize).photosBlock}>
            <Text style={styles(theme, photoTileSize).photosLabel}>
              {t('support_request_photos_label').replace('{count}', String(SUPPORT_PHOTO_MAX_COUNT))}
            </Text>
            <View style={styles(theme, photoTileSize).previewGrid}>
              <Pressable
                onPress={pickFromGallery}
                style={({ pressed }) => [
                  styles(theme, photoTileSize).previewItem,
                  styles(theme, photoTileSize).addTile,
                  pressed && styles(theme, photoTileSize).previewPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('support_request_add_more_photos')}
              >
                <Feather name="plus" size={theme.icons?.md || 22} color={theme.colors.primary} />
              </Pressable>

              {photoUris.map((uri, index) => (
                <View key={`${uri}_${index}`} style={styles(theme, photoTileSize).previewItem}>
                  <Pressable
                    onPress={() => {
                      setViewerIndex(index);
                      setViewerVisible(true);
                    }}
                    style={({ pressed }) => [
                      styles(theme, photoTileSize).previewFill,
                      pressed && styles(theme, photoTileSize).previewPressed,
                    ]}
                  >
                    <Image source={{ uri }} style={styles(theme, photoTileSize).previewImage} resizeMode="cover" />
                  </Pressable>
                  <Pressable
                    onPress={() => requestRemovePhoto(index)}
                    style={styles(theme, photoTileSize).removeBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t('order_photos_delete_single_confirm')}
                  >
                    <View style={styles(theme, photoTileSize).removeBtnBg}>
                      <Feather
                        name="x"
                        size={(theme.icons?.sm || 16) - (theme.spacing?.xs || 4)}
                        color={theme.colors.onPrimary}
                      />
                    </View>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </BaseModal>

      <ConfirmModal
        visible={confirmDiscardVisible}
        onClose={() => setConfirmDiscardVisible(false)}
        title={t('dlg_leave_title')}
        message={t('support_request_discard_confirm')}
        confirmLabel={t('dlg_leave_confirm')}
        cancelLabel={t('dlg_leave_cancel')}
        confirmVariant="destructive"
        onConfirm={() => {
          setConfirmDiscardVisible(false);
          closeWithoutConfirm();
        }}
      />

      <ConfirmModal
        visible={confirmRemovePhotoVisible}
        onClose={() => {
          setConfirmRemovePhotoVisible(false);
          setPendingRemovePhotoIndex(null);
        }}
        title={t('order_photos_delete_single_title')}
        message={t('order_photos_delete_single_message')}
        confirmLabel={t('order_photos_delete_single_confirm')}
        cancelLabel={t('order_photos_delete_single_cancel')}
        confirmVariant="destructive"
        onConfirm={removePhoto}
      />

      <FullscreenImageViewer
        visible={viewerVisible}
        images={photoUris}
        initialIndex={viewerIndex}
        onClose={() => setViewerVisible(false)}
        categoryLabel={t('order_details_photos_section')}
      />
    </>
  );
}

const styles = (theme, photoTileSize = 88) =>
  StyleSheet.create({
    scroll: {
      flexGrow: 0,
      minHeight: 0,
    },
    contentWrap: {
      gap: theme.spacing.sm,
      paddingBottom: theme.spacing.lg,
    },
    counterWrap: {
      alignItems: 'flex-end',
      marginTop: -theme.spacing.xs,
      marginBottom: theme.spacing.xs,
    },
    counterText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
    },
    photosBlock: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
    },
    photosLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    previewGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      alignItems: 'flex-start',
      paddingBottom: theme.spacing.xs,
    },
    previewItem: {
      width: photoTileSize,
      aspectRatio: 1,
      borderRadius: theme.radii.md,
      overflow: 'hidden',
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.inputBg,
      position: 'relative',
    },
    previewFill: {
      width: '100%',
      height: '100%',
    },
    addTile: {
      alignItems: 'center',
      justifyContent: 'center',
      borderStyle: 'dashed',
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.surface,
    },
    previewPressed: {
      opacity: 0.85,
    },
    previewImage: {
      width: '100%',
      height: '100%',
    },
    removeBtn: {
      position: 'absolute',
      top: theme.spacing.xs,
      right: theme.spacing.xs,
      zIndex: 10,
    },
    removeBtnBg: {
      width: theme.spacing.xl,
      height: theme.spacing.xl,
      borderRadius: theme.radii.pill,
      backgroundColor: theme.colors.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    footerRow: {
      flexDirection: 'row',
      gap: theme.spacing.md,
    },
    ghostButton: {
      flex: 1,
      minHeight: theme.components.row.minHeight,
      borderRadius: theme.radii.md,
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
    },
    ghostButtonText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.medium,
    },
  });
