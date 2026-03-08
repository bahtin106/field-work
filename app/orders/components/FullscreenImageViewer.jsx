// app/orders/components/FullscreenImageViewer.jsx
// Professional fullscreen image gallery viewer using react-native-image-viewing.
// Supports pinch-zoom, swipe-to-dismiss, counter pill – just like Telegram/WhatsApp.

import { memo, useMemo, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, StatusBar } from 'react-native';
import ImageViewing from 'react-native-image-viewing';
import { useTheme } from '../../../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function FullscreenImageViewer({ visible, images, initialIndex = 0, onClose }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const imageData = useMemo(
    () => (images || []).filter(Boolean).map((uri) => ({ uri })),
    [images],
  );

  const renderHeader = useCallback(
    ({ imageIndex }) => (
      <View style={[styles.header, { paddingTop: (insets.top || 0) + 8 }]}>
        <View
          style={[
            styles.counterPill,
            { backgroundColor: theme.colors.overlay },
          ]}
        >
          <Text style={[styles.counterText, { color: theme.colors.onPrimary }]}>
            {imageData.length ? `${imageIndex + 1} / ${imageData.length}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={[styles.closeBtn, { backgroundColor: theme.colors.overlay }]}
        >
          <Text style={{ color: theme.colors.onPrimary, fontSize: 22, fontWeight: '700' }}>
            ×
          </Text>
        </Pressable>
      </View>
    ),
    [imageData.length, insets.top, onClose, theme],
  );

  if (!imageData.length) return null;

  return (
    <ImageViewing
      images={imageData}
      imageIndex={initialIndex}
      visible={visible}
      onRequestClose={onClose}
      swipeToCloseEnabled
      doubleTapToZoomEnabled
      presentationStyle="overFullScreen"
      backgroundColor={theme.colors.background}
      HeaderComponent={renderHeader}
    />
  );
}

export default memo(FullscreenImageViewer);

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  counterPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  counterText: {
    fontWeight: '700',
    fontSize: 14,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
